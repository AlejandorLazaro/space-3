"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { IlamyCalendar } from "@ilamy/calendar";
import type { CalendarEvent } from "@ilamy/calendar";
import { agendaPlugin } from "@ilamy/calendar/plugins/agenda";
import { Card, Button, Input, Textarea, Label } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { createClient } from "@/lib/supabase/client";
import {
  fetchCalendarEvents,
  updateEvent,
  deleteEvent,
  insertEvent,
  extractChatId,
  type EventWithCohort,
  type RsvpStatus,
} from "@/lib/calendar/events";
import { fetchEventRsvps, upsertRsvp, type RsvpWithProfile } from "@/lib/calendar/rsvps";
import { createEventChat, describeEventChatLifecycle } from "@/lib/calendar/chats";
import { showErrorToast, ToastHost } from "@/components/Toast";
import ChatPanel from "@/components/ChatPanel";
import {
  fetchRecurringAvailability,
  fetchAvailabilityOverrides,
  resolveAvailableBlocks,
  type RecurringAvailabilityRow,
  type AvailabilityOverrideRow,
} from "@/lib/calendar/availability";

// ---------------------------------------------------------------------------
// GROUP layer: real Supabase data against 008_events_rsvps.sql + 014's color
// column. PERSONAL layer: real Supabase data against 013's recurring +
// override tables, resolved client-side into concrete "available" blocks.
//
// Click-to-Read/Update/Delete: providing `onEventClick` at all disables
// ilamy's own default "open for editing" behavior (confirmed in its docs),
// and there's no built-in per-event edit/delete gating predicate (checked —
// doesn't exist), so this component owns the entire view/edit/delete flow
// itself via a custom modal rather than ilamy's internal form.
//
// Requires 012 (UPDATE policy), 014 (color column), 015 (DELETE policy).
// ---------------------------------------------------------------------------

type CalLayer = "personal" | "group";

interface PocEventData {
  layer: CalLayer;
  /** false = either a computed availability block, or a group event you didn't create. */
  editable: boolean;
  cohortId?: string;
  cohortName?: string;
  /** Raw (un-suffixed) title — the displayed `title` may have " — Cohort Name" appended. */
  rawTitle?: string;
  description?: string | null;
  location?: string | null;
  /** This event's dedicated coordination chat (016_chat_levels.sql) — null if creation's second insert (createEventChat) failed. */
  chatId?: string | null;
  /** Hours after this event ends before its chat closes — 019_events_chat_grace_period.sql. */
  chatClosesAfterHours?: number;
  [key: string]: unknown; // required for structural compatibility with CalendarEvent['data']
}

interface PocCalendarEvent {
  id: string;
  title: string;
  start: dayjs.Dayjs;
  end: dayjs.Dayjs;
  color: string;
  backgroundColor: string;
  data: PocEventData;
}

const PERSONAL_COLOR = "#2563eb"; // matches space3-design-doc.md: personal = blue
const GROUP_COLOR = "#16a34a"; // group = green (fallback when no color was ever set)
const COLOR_PRESETS = ["#16a34a", "#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

function getEventData(event: CalendarEvent): PocEventData {
  return (event.data as PocEventData | undefined) ?? { layer: "group", editable: false };
}

function groupRowToCalendarEvent(
  row: EventWithCohort,
  currentUserId: string | null
): PocCalendarEvent | null {
  if (!row.starts_at) return null; // TBD events excluded — no sane grid position, mirrors calendar-feed Edge Function
  const end = row.ends_at ?? row.starts_at;
  const resolvedColor = row.color ?? GROUP_COLOR;
  const cohortName = row.cohorts?.name;
  return {
    id: row.id,
    title: cohortName ? `${row.title} — ${cohortName}` : row.title,
    start: dayjs(row.starts_at),
    end: dayjs(end),
    // Setting both — CalendarEvent has separate `color`/`backgroundColor`
    // fields and it's not verifiable from static analysis alone which one
    // ilamy's chip rendering actually prioritizes for fill vs. text/accent.
    // Setting both to the same persisted value sidesteps the ambiguity.
    color: resolvedColor,
    backgroundColor: resolvedColor,
    data: {
      layer: "group",
      editable: currentUserId != null && row.created_by === currentUserId,
      cohortId: row.cohort_id,
      chatId: extractChatId(row.chats),
      chatClosesAfterHours: row.chat_closes_after_hours,
      cohortName,
      rawTitle: row.title,
      description: row.description,
      location: row.location,
    },
  };
}

interface CohortCalendarPocProps {
  /**
   * When set, scopes the calendar to a single cohort's events only (still
   * RLS-bounded either way — this is a UI narrowing, not a security boundary).
   * Omit for the aggregate view across all of the user's cohorts.
   */
  cohortId?: string;
  /** When set, auto-opens that event's detail modal once its data has loaded — used for deep-links like the sidebar's Upcoming Events widget. */
  initialEventId?: string;
}

export default function CohortCalendarPoc({ cohortId, initialEventId }: CohortCalendarPocProps) {
  const [visibleLayers, setVisibleLayers] = useState<Record<CalLayer, boolean>>({
    personal: true,
    group: true,
  });

  const [groupEvents, setGroupEvents] = useState<PocCalendarEvent[]>([]);
  const autoOpenedRef = useRef(false);
  const [recurring, setRecurring] = useState<RecurringAvailabilityRow[]>([]);
  const [overrides, setOverrides] = useState<AvailabilityOverrideRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [cohortName, setCohortName] = useState<string | null>(null);

  // Default to the current week before the calendar's first onDateChange
  // fires (not guaranteed to fire on initial mount, only on navigation).
  const [visibleRange, setVisibleRange] = useState(() => ({
    start: dayjs().startOf("week"),
    end: dayjs().endOf("week"),
  }));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read/Update/Delete modal state
  const [selectedEvent, setSelectedEvent] = useState<PocCalendarEvent | null>(null);
  const [editing, setEditing] = useState(false);
  const [modalTab, setModalTab] = useState<"details" | "chat">("details");
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editColor, setEditColor] = useState(GROUP_COLOR);
  const [editChatGraceHours, setEditChatGraceHours] = useState(0);

  // RSVP state — scoped to whichever event is currently selected
  const [rsvps, setRsvps] = useState<RsvpWithProfile[]>([]);
  const [rsvpsLoading, setRsvpsLoading] = useState(false);
  const [savingRsvp, setSavingRsvp] = useState(false);

  // Cohort name, for the "which calendar am I looking at" reminder in the header.
  useEffect(() => {
    if (!cohortId) {
      setCohortName(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data, error: fetchError } = await supabase
        .from("cohorts")
        .select("name")
        .eq("id", cohortId)
        .single();
      if (!cancelled && !fetchError) setCohortName(data?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [cohortId]);

  // Group events + recurring baseline: fetched once (recurring doesn't
  // depend on visible range) or whenever cohortId changes.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        setCurrentUserId(user?.id ?? null);

        const [eventRows, recurringRows] = await Promise.all([
          fetchCalendarEvents(cohortId),
          fetchRecurringAvailability(),
        ]);
        if (cancelled) return;

        const mapped = eventRows
          .map((row) => groupRowToCalendarEvent(row, user?.id ?? null))
          .filter((e): e is PocCalendarEvent => e !== null);
        setGroupEvents(mapped);
        setRecurring(recurringRows);
      } catch (err) {
        console.error("Failed to load calendar data:", err);
        if (!cancelled) setError("Couldn't load the calendar. Try reloading this page.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cohortId]);

  // Overrides: re-fetched whenever the visible date range changes, since
  // this table could grow large over time and there's no reason to pull
  // more than what's on screen.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const rows = await fetchAvailabilityOverrides(
          visibleRange.start.format("YYYY-MM-DD"),
          visibleRange.end.format("YYYY-MM-DD")
        );
        if (!cancelled) setOverrides(rows);
      } catch (err) {
        console.error("Failed to load availability overrides:", err);
        // Not surfacing this as a page-level error — recurring availability
        // still renders fine without overrides; degrade gracefully.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visibleRange]);

  const personalEvents: PocCalendarEvent[] = useMemo(() => {
    const blocks = resolveAvailableBlocks(recurring, overrides, visibleRange.start, visibleRange.end);
    return blocks.map((b, i) => ({
      id: `avail-${b.start.valueOf()}-${i}`,
      title: "Available",
      start: b.start,
      end: b.end,
      color: PERSONAL_COLOR,
      backgroundColor: PERSONAL_COLOR,
      data: { layer: "personal", editable: false },
    }));
  }, [recurring, overrides, visibleRange]);

  const events = useMemo(() => {
    const layers: PocCalendarEvent[] = [];
    if (visibleLayers.personal) layers.push(...personalEvents);
    if (visibleLayers.group) layers.push(...groupEvents);
    return layers;
  }, [visibleLayers, groupEvents, personalEvents]);

  function toggleLayer(layer: CalLayer) {
    setVisibleLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }

  const handleEventUpdate = useCallback(async (updated: CalendarEvent) => {
    const { editable } = getEventData(updated);
    if (!editable) {
      console.warn("Blocked move: event is view-only.", updated.id);
      return; // don't touch state — calendar re-renders from unchanged `groupEvents`, move visually reverts
    }

    const newStart = dayjs(updated.start);
    const newEnd = dayjs(updated.end);

    setGroupEvents((prev) =>
      prev.map((e) =>
        String(e.id) === String(updated.id) ? { ...e, start: newStart, end: newEnd } : e
      )
    );

    try {
      await updateEvent(String(updated.id), {
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString(),
      });
    } catch (err) {
      console.error("Failed to persist event move:", err);
      const message =
        err instanceof Error
          ? err.message
          : "Couldn't save that change — reload to see the real state. (Check that 012_events_update_policy.sql has been applied.)";
      setError(message);
      showErrorToast(message);
    }
  }, []);

  const handleEventAdd = useCallback(
    async (added: CalendarEvent) => {
      // events.cohort_id is NOT NULL — there's no valid cohort to attach a
      // new event to on the aggregate view. isCellDisabled (wired below)
      // should already prevent reaching this in that case; this is a second
      // guard, not the primary defense.
      if (!cohortId || !currentUserId) {
        console.warn("Blocked event creation: no cohort context.", { cohortId, currentUserId });
        setError("Open a specific cohort's calendar to create events.");
        return;
      }

      // Captured defensively from both fields — see the comment on
      // groupRowToCalendarEvent for why the split isn't fully verifiable
      // from static analysis alone. Not persisting a color at all means
      // this create call never had one; falls back to the default at read time.
      const pickedColor =
        (added.color as string | undefined) ?? (added.backgroundColor as string | undefined) ?? null;

      try {
        const inserted = await insertEvent({
          cohort_id: cohortId,
          created_by: currentUserId,
          title: added.title || "Untitled event",
          description: added.description ?? null,
          location: added.location ?? null,
          starts_at: dayjs(added.start).toISOString(),
          ends_at: dayjs(added.end).toISOString(),
          color: pickedColor,
        });

        let chatId: string | null = null;
        try {
          chatId = await createEventChat({
            cohort_id: cohortId,
            event_id: inserted.id,
            title: inserted.title,
            created_by: currentUserId,
          });
        } catch (chatErr) {
          // The event itself was created successfully — don't fail the
          // whole creation over the chat. Degrades to "no chat tab for this
          // event" rather than losing the event entirely.
          console.error("Event created, but its chat could not be created:", chatErr);
          setError("Event created, but its chat couldn't be set up.");
        }

        const mapped = groupRowToCalendarEvent(inserted, currentUserId);
        if (mapped) {
          setGroupEvents((prev) => [...prev, { ...mapped, data: { ...mapped.data, chatId } }]);
        }
      } catch (err) {
        console.error("Failed to create event:", err);
        const message = err instanceof Error ? err.message : "Couldn't save the new event. Try again.";
        setError(message);
        showErrorToast(message);
      }
    },
    [cohortId, currentUserId]
  );

  const isCellDisabled = useMemo(() => {
    return cohortId ? undefined : () => true;
  }, [cohortId]);

  const handleDateChange = useCallback(
    (_date: dayjs.Dayjs, range: { start: dayjs.Dayjs; end: dayjs.Dayjs }) => {
      setVisibleRange({ start: range.start, end: range.end });
    },
    []
  );

  const handleEventClick = useCallback((clicked: CalendarEvent) => {
    const data = getEventData(clicked);
    setSelectedEvent({
      id: String(clicked.id),
      title: clicked.title,
      start: dayjs(clicked.start),
      end: dayjs(clicked.end),
      color: (clicked.color as string | undefined) ?? GROUP_COLOR,
      backgroundColor: (clicked.backgroundColor as string | undefined) ?? GROUP_COLOR,
      data,
    });
    setEditing(false);
    setModalTab("details");
  }, []);

  // Deep-link support: auto-open the event named in ?eventId= once it's
  // loaded (used by the sidebar's Upcoming Events widget). Only fires once
  // per mount — the ref guards against re-opening if the user closes the
  // modal and groupEvents happens to update again afterward (e.g. after an
  // edit).
  useEffect(() => {
    if (!initialEventId || autoOpenedRef.current) return;
    const match = groupEvents.find((e) => e.id === initialEventId);
    if (match) {
      setSelectedEvent(match);
      setEditing(false);
      setModalTab("details");
      autoOpenedRef.current = true;
    }
  }, [groupEvents, initialEventId]);

  // RSVPs only apply to real group events — not computed personal blocks.
  useEffect(() => {
    if (!selectedEvent || selectedEvent.data.layer !== "group") {
      setRsvps([]);
      return;
    }
    let cancelled = false;
    setRsvpsLoading(true);
    fetchEventRsvps(selectedEvent.id)
      .then((rows) => {
        if (!cancelled) setRsvps(rows);
      })
      .catch((err) => {
        console.error("Failed to load RSVPs:", err);
        if (!cancelled) setError("Couldn't load who's attending.");
      })
      .finally(() => {
        if (!cancelled) setRsvpsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEvent?.id, selectedEvent?.data.layer]);

  const myRsvpStatus: RsvpStatus | null = useMemo(() => {
    if (!currentUserId) return null;
    return rsvps.find((r) => r.user_id === currentUserId)?.status ?? null;
  }, [rsvps, currentUserId]);

  const handleSetRsvp = useCallback(
    async (status: RsvpStatus) => {
      if (!selectedEvent || !currentUserId) return;
      setSavingRsvp(true);
      setError(null);
      const eventId = selectedEvent.id;
      try {
        await upsertRsvp(eventId, currentUserId, status);
        // Refetch rather than patch state locally — a local optimistic
        // patch would need the current user's own display_name, which
        // this component doesn't otherwise fetch/hold, and a refetch here
        // is cheap (single small query) and guaranteed correct.
        const fresh = await fetchEventRsvps(eventId);
        setRsvps(fresh);
      } catch (err) {
        console.error("Failed to save RSVP:", err);
        const message = err instanceof Error ? err.message : "Couldn't save your RSVP. Try again.";
        setError(message);
        showErrorToast(message);
      } finally {
        setSavingRsvp(false);
      }
    },
    [selectedEvent, currentUserId]
  );

  function startEdit() {
    if (!selectedEvent) return;
    setEditTitle((selectedEvent.data.rawTitle as string) ?? selectedEvent.title);
    setEditDescription((selectedEvent.data.description as string) ?? "");
    setEditLocation((selectedEvent.data.location as string) ?? "");
    setEditStart(selectedEvent.start.format("YYYY-MM-DDTHH:mm"));
    setEditEnd(selectedEvent.end.format("YYYY-MM-DDTHH:mm"));
    setEditColor(selectedEvent.color);
    setEditChatGraceHours((selectedEvent.data.chatClosesAfterHours as number) ?? 0);
    setEditing(true);
  }

  const handleSaveEdit = useCallback(async () => {
    if (!selectedEvent) return;
    setSavingEdit(true);
    setError(null);
    try {
      const newStart = dayjs(editStart);
      const newEnd = dayjs(editEnd);
      await updateEvent(selectedEvent.id, {
        title: editTitle,
        description: editDescription || null,
        location: editLocation || null,
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString(),
        color: editColor,
        chat_closes_after_hours: editChatGraceHours,
      });
      const cohortNameForRow = selectedEvent.data.cohortName as string | undefined;
      setGroupEvents((prev) =>
        prev.map((e) =>
          e.id === selectedEvent.id
            ? {
                ...e,
                title: cohortNameForRow ? `${editTitle} — ${cohortNameForRow}` : editTitle,
                start: newStart,
                end: newEnd,
                color: editColor,
                backgroundColor: editColor,
                data: {
                  ...e.data,
                  rawTitle: editTitle,
                  description: editDescription || null,
                  location: editLocation || null,
                  chatClosesAfterHours: editChatGraceHours,
                },
              }
            : e
        )
      );
      setSelectedEvent(null);
      setEditing(false);
    } catch (err) {
      console.error("Failed to save event:", err);
      const message = err instanceof Error ? err.message : "Couldn't save changes. Try again.";
      setError(message);
      showErrorToast(message);
    } finally {
      setSavingEdit(false);
    }
  }, [
    selectedEvent,
    editTitle,
    editDescription,
    editLocation,
    editStart,
    editEnd,
    editColor,
    editChatGraceHours,
  ]);

  const handleConfirmDelete = useCallback(async () => {
    if (!selectedEvent) return;
    setDeleting(true);
    try {
      await deleteEvent(selectedEvent.id);
      setGroupEvents((prev) => prev.filter((e) => e.id !== selectedEvent.id));
      setDeleteConfirmOpen(false);
      setSelectedEvent(null);
    } catch (err) {
      console.error("Failed to delete event:", err);
      const message =
        err instanceof Error
          ? err.message
          : "Couldn't delete that event. Try again. (Check that 015_events_delete_policy.sql has been applied.)";
      setError(message);
      showErrorToast(message);
    } finally {
      setDeleting(false);
    }
  }, [selectedEvent]);

  const headerTitle = cohortId
    ? cohortName
      ? `${cohortName} — Calendar`
      : "Cohort calendar"
    : "Calendar";

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl">{headerTitle}</h1>
        <div className="flex gap-2">
          <Button
            variant={visibleLayers.personal ? "primary" : "secondary"}
            onClick={() => toggleLayer("personal")}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: PERSONAL_COLOR }}
            />
            Personal
          </Button>
          <Button
            variant={visibleLayers.group ? "primary" : "secondary"}
            onClick={() => toggleLayer("group")}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: GROUP_COLOR }}
            />
            Group
          </Button>
        </div>
      </div>

      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        {cohortId
          ? "Events for this cohort only."
          : "Your availability, plus events across all your cohorts. Open a specific cohort's calendar to create new events."}
      </p>

      {error && (
        <p className="mt-2 text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-6 text-sm text-[var(--color-ink-faint)]">Loading calendar…</p>
      ) : (
        <div className="mt-6 flex flex-col overflow-hidden" style={{ height: 700 }}>
          <IlamyCalendar
            events={events}
            initialView="week"
            plugins={[agendaPlugin()]}
            onEventClick={handleEventClick}
            onEventAdd={handleEventAdd}
            onEventUpdate={handleEventUpdate}
            onDateChange={handleDateChange}
            isCellDisabled={isCellDisabled}
          />
        </div>
      )}

      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            {selectedEvent.data.layer === "personal" ? (
              <>
                <h2 className="font-display text-lg">Available</h2>
                <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                  {selectedEvent.start.format("ddd, MMM D, h:mm A")} –{" "}
                  {selectedEvent.end.format("h:mm A")}
                </p>
                <p className="mt-2 text-sm text-[var(--color-ink-faint)]">
                  From your weekly pattern or an override. Manage this in Settings → Availability.
                </p>
                <div className="mt-4 flex justify-end">
                  <Button variant="secondary" onClick={() => setSelectedEvent(null)}>
                    Close
                  </Button>
                </div>
              </>
            ) : !editing ? (
              <>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: selectedEvent.color }}
                  />
                  <h2 className="font-display text-lg">
                    {(selectedEvent.data.rawTitle as string) ?? selectedEvent.title}
                  </h2>
                </div>
                {selectedEvent.data.cohortName && (
                  <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                    {selectedEvent.data.cohortName as string}
                  </p>
                )}

                <div className="mt-3 flex gap-2 border-b border-[var(--color-line)]">
                  <button
                    type="button"
                    onClick={() => setModalTab("details")}
                    className={
                      "px-2 pb-2 text-sm " +
                      (modalTab === "details"
                        ? "border-b-2 border-[var(--color-ink)] text-[var(--color-ink)]"
                        : "text-[var(--color-ink-faint)]")
                    }
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalTab("chat")}
                    className={
                      "px-2 pb-2 text-sm " +
                      (modalTab === "chat"
                        ? "border-b-2 border-[var(--color-ink)] text-[var(--color-ink)]"
                        : "text-[var(--color-ink-faint)]")
                    }
                  >
                    Chat
                  </button>
                </div>

                {modalTab === "details" ? (
                  <>
                    <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
                      {selectedEvent.start.format("ddd, MMM D, h:mm A")} –{" "}
                      {selectedEvent.end.format("h:mm A")}
                    </p>
                {selectedEvent.data.location && (
                  <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                    📍 {selectedEvent.data.location as string}
                  </p>
                )}
                {selectedEvent.data.description && (
                  <p className="mt-2 text-sm text-[var(--color-ink)]">
                    {selectedEvent.data.description as string}
                  </p>
                )}

                {/* RSVP — applies to every group event regardless of who created it. */}
                <div className="mt-4 border-t border-[var(--color-line)] pt-4">
                  <p className="font-mono-tag mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                    Your RSVP
                  </p>
                  <div className="flex gap-2">
                    {(["going", "maybe", "not_going"] as const).map((status) => (
                      <Button
                        key={status}
                        variant={myRsvpStatus === status ? "primary" : "secondary"}
                        onClick={() => handleSetRsvp(status)}
                        disabled={savingRsvp}
                      >
                        {status === "going" ? "Going" : status === "maybe" ? "Maybe" : "Not going"}
                      </Button>
                    ))}
                  </div>

                  <p className="font-mono-tag mb-2 mt-4 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                    Attending
                  </p>
                  {rsvpsLoading ? (
                    <p className="text-sm text-[var(--color-ink-faint)]">Loading…</p>
                  ) : rsvps.length === 0 ? (
                    <p className="text-sm text-[var(--color-ink-faint)]">No RSVPs yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {rsvps.map((r) => (
                        <li
                          key={r.user_id}
                          className="flex items-center justify-between text-sm text-[var(--color-ink)]"
                        >
                          <span>
                            {r.display_name ?? "Member"}
                            {r.user_id === currentUserId && (
                              <span className="text-[var(--color-ink-faint)]"> (you)</span>
                            )}
                          </span>
                          <span className="text-xs text-[var(--color-ink-soft)]">
                            {r.status === "going"
                              ? "Going"
                              : r.status === "maybe"
                                ? "Maybe"
                                : "Not going"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                  </>
                ) : (
                  <div className="mt-3">
                    {selectedEvent.data.chatId ? (
                      <ChatPanel
                        currentUserId={currentUserId ?? ""}
                        chatId={selectedEvent.data.chatId as string}
                        title="Event chat"
                        readOnly={selectedEvent.end
                          .add((selectedEvent.data.chatClosesAfterHours as number) ?? 0, "hour")
                          .isBefore(dayjs())}
                        closedNotice="This event has ended — chat is read-only."
                        infoBanner={describeEventChatLifecycle(
                          selectedEvent.end.toISOString(),
                          (selectedEvent.data.chatClosesAfterHours as number) ?? 0
                        )}
                      />
                    ) : (
                      <p className="text-sm text-[var(--color-ink-faint)]">
                        This event doesn&rsquo;t have a chat set up. (Its creation may have partially
                        failed — see the error banner if one appeared when it was created.)
                      </p>
                    )}
                  </div>
                )}

                {!selectedEvent.data.editable && (
                  <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                    Created by another member — view only.
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setSelectedEvent(null)}>
                    Close
                  </Button>
                  {selectedEvent.data.editable && (
                    <>
                      <Button variant="secondary" onClick={startEdit}>
                        Edit
                      </Button>
                      <Button variant="danger" onClick={() => setDeleteConfirmOpen(true)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <h2 className="font-display text-lg">Edit event</h2>
                <div className="mt-4 flex flex-col gap-3">
                  <div>
                    <Label>Title</Label>
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Location</Label>
                    <Input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Label>Start</Label>
                      <Input
                        type="datetime-local"
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                      />
                    </div>
                    <div className="flex-1">
                      <Label>End</Label>
                      <Input
                        type="datetime-local"
                        value={editEnd}
                        onChange={(e) => setEditEnd(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Color</Label>
                    <div className="flex gap-2">
                      {COLOR_PRESETS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setEditColor(c)}
                          className="h-7 w-7 rounded-full border-2"
                          style={{
                            backgroundColor: c,
                            borderColor: editColor === c ? "var(--color-ink)" : "transparent",
                          }}
                          aria-label={`Color ${c}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Chat stays open</Label>
                    <select
                      value={editChatGraceHours}
                      onChange={(e) => setEditChatGraceHours(Number(e.target.value))}
                      className="rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm text-[var(--color-ink)]"
                    >
                      <option value={0}>Until the event ends</option>
                      <option value={1}>1 hour after</option>
                      <option value={24}>1 day after</option>
                      <option value={72}>3 days after</option>
                      <option value={168}>1 week after</option>
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setEditing(false)} disabled={savingEdit}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleSaveEdit} disabled={savingEdit}>
                    {savingEdit ? "Saving…" : "Save"}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete this event?"
        body="This can't be undone. Anyone who RSVP'd will lose access to it."
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        cancelLabel="Cancel"
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
      />

      <ToastHost />
    </Card>
  );
}