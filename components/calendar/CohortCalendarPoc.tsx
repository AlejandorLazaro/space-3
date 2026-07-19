"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import dayjs from "dayjs";
import {
  IlamyCalendar,
  CalendarEvent,
  RenderCurrentTimeIndicatorProps,
  useIlamyCalendarContext,
  type IlamyCalendarApi,
  type CellInfo,
} from "@ilamy/calendar";
import { agendaPlugin } from "@ilamy/calendar/plugins/agenda";
import { Card, Button, Input, Textarea, Label } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import CustomCalendarHeader from "@/components/calendar/CustomCalendarHeader";
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
  insertAvailabilityOverride,
  deleteAvailabilityOverride,
  updateRecurringAvailability,
  deleteRecurringAvailability,
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
// Creation (New button + edit) also goes through this same custom modal now
// — see openCreateModal/handleCreateNew — rather than ilamy's own built-in
// event-creation form, whose color picker doesn't match our 6-preset system
// and was producing events with unusable color values (see UI pass notes).
//
// Requires 012 (UPDATE policy), 014 (color column), 015 (DELETE policy).
// ---------------------------------------------------------------------------

type CalLayer = "personal" | "group";

interface PocEventData {
  layer: CalLayer;
  /** false = either a computed availability block, or a group event you didn't create. */
  editable: boolean;
  /** Personal blocks only — which underlying record produced this resolved interval. Every block on a given date is entirely one or the other, never mixed, since date-specific overrides fully replace the recurring baseline for that date (see resolveAvailableBlocks). Drives the edit-mode dimming and interaction gating. */
  source?: "recurring" | "oneoff";
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

interface EditingAvailability {
  date: string; // YYYY-MM-DD
  start: string; // HH:mm, for the "add a window" action
  end: string; // HH:mm
  hasExistingOverrides: boolean;
}

interface EditingRecurring {
  dayOfWeek: number;
  rowId: string;
  start: string; // HH:mm
  end: string; // HH:mm
}

/** "view" = default, safe, no drag mutates anything. "recurring"/"oneoff" = which source type dragging and clicking will act on — the other type becomes visually dimmed and fully inert to click/drag while active. */
type AvailabilityEditMode = "view" | "recurring" | "oneoff";

const PERSONAL_COLOR = "#94a3b8"; // standardized, non-customizable — fallback for surfaces (e.g. agenda plugin) that may not honor renderEvent's dashed treatment
const GROUP_COLOR = "#16a34a"; // group = green (fallback when no color was ever set)
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COLOR_PRESETS = ["#16a34a", "#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

function isHexColor(value: string | null | undefined): value is string {
  return !!value && /^#([0-9a-f]{6})$/i.test(value.trim());
}

/** Checked live at the moment of each edit attempt, not cached — so a form left open across the event's end time still gets caught on save, not just on open. */
function hasEnded(end: dayjs.Dayjs): boolean {
  return end.isBefore(dayjs());
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getEventData(event: CalendarEvent): PocEventData {
  return (event.data as PocEventData | undefined) ?? { layer: "group", editable: false };
}

function groupRowToCalendarEvent(
  row: EventWithCohort,
  currentUserId: string | null
): PocCalendarEvent | null {
  if (!row.starts_at) return null; // TBD events excluded — no sane grid position, mirrors calendar-feed Edge Function
  const end = row.ends_at ?? row.starts_at;
  // Sanitized here, at the single read path, so any event created via
  // ilamy's own built-in form (or bad test data) with a non-hex color value
  // (e.g. a Tailwind-token-shaped string) falls back cleanly instead of
  // rendering invisible — see UI pass notes on the "invisible new event" bug.
  const resolvedColor = isHexColor(row.color) ? row.color : GROUP_COLOR;
  const cohortName = row.cohorts?.name;
  return {
    id: row.id,
    title: cohortName ? `${row.title} — ${cohortName}` : row.title,
    start: dayjs(row.starts_at),
    end: dayjs(end),
    // Two-tone: `color` is the solid accent (border + text), `backgroundColor`
    // is a light tint derived from it — matches ilamy's own default event
    // styling convention more closely than a single flat fill.
    color: resolvedColor,
    backgroundColor: hexToRgba(resolvedColor, 0.14),
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

function renderCurrentTimeIndicator({
  currentTime,
  progress,
  axis,
  view,
}: RenderCurrentTimeIndicatorProps) {
  if (view === "agenda") return null;

  if (axis === "horizontal") {
    return (
      <div style={{ left: `${progress}%` }} className="absolute top-0 bottom-0 pointer-events-none">
        <div className="w-0.5 h-full bg-red-500" />
      </div>
    );
  }
  return (
    <div style={{ top: `${progress}%` }} className="absolute left-0 right-0 pointer-events-none">
      <div className="h-0.5 bg-red-500" />
      <span className="absolute left-0 -translate-y-1/2 bg-red-500 text-white text-[10px] px-1 rounded-r-sm">
        {currentTime.format("h:mm A")}
      </span>
    </div>
  );
}

/**
 * Renders inside IlamyCalendar's own tree (via headerComponent, alongside
 * CustomCalendarHeader) purely to reach useIlamyCalendarContext() — that
 * hook throws outside the provider, and CohortCalendarPoc itself is an
 * ancestor of <IlamyCalendar>, not a descendant, so it can't call the hook
 * directly. Exposes the live API to the parent via a ref rather than a
 * callback, since the parent needs to call into it imperatively (forcing a
 * drag revert) from inside a separate event handler, not react to it.
 *
 * Unconfirmed assumption this whole bridge depends on: that headerComponent
 * is actually mounted inside the context provider tree. First thing to
 * check if this throws a "must be used within a provider" error.
 */
function CalendarApiBridge({ apiRef }: { apiRef: MutableRefObject<IlamyCalendarApi | null> }) {
  const api = useIlamyCalendarContext();
  apiRef.current = api;
  return null;
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
  /** Initial Personal/Group layer visibility. Defaults to both on — used by AvailabilityPanel to default Group off, since that surface is about availability, not events. */
  defaultVisibleLayers?: Record<CalLayer, boolean>;
  /** Passed straight through to IlamyCalendar — lets an embedding page (e.g. AvailabilityPanel) carry over its own 12h/24h preference into the calendar's time gutter. */
  timeFormat?: "12-hour" | "24-hour";
  /** Suppresses the "Calendar" title + description + layer-toggle block — used when embedding inside a page (e.g. Settings) that already has its own heading, to avoid a duplicated title. */
  hideHeader?: boolean;
}

export default function CohortCalendarPoc({
  cohortId,
  initialEventId,
  defaultVisibleLayers,
  timeFormat,
  hideHeader,
}: CohortCalendarPocProps) {
  const [visibleLayers, setVisibleLayers] = useState<Record<CalLayer, boolean>>(
    defaultVisibleLayers ?? {
      personal: true,
      group: true,
    }
  );

  const [groupEvents, setGroupEvents] = useState<PocCalendarEvent[]>([]);
  const autoOpenedRef = useRef(false);
  const ilamyApiRef = useRef<IlamyCalendarApi | null>(null);
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

  // Create/Read/Update/Delete modal state
  const [creatingNew, setCreatingNew] = useState(false);
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
    // Every block on a given date is entirely recurring-derived or entirely
    // override-derived, never mixed — overrides fully replace the recurring
    // baseline for their date (see resolveAvailableBlocks). So provenance
    // can be tagged per-date from data already loaded here, with no changes
    // needed to the resolve function itself.
    const overrideDates = new Set(overrides.map((o) => o.override_date));
    return blocks.map((b, i) => {
      const dateKey = b.start.format("YYYY-MM-DD");
      const source: "recurring" | "oneoff" = overrideDates.has(dateKey) ? "oneoff" : "recurring";
      return {
        id: `avail-${b.start.valueOf()}-${i}`,
        // The time range lives in the title itself (not just renderCalendarEvent's
        // JSX) because Agenda may render its own list items straight from
        // event.title rather than going through our custom renderEvent — see
        // the PERSONAL_COLOR fallback comment for the same uncertainty. This
        // way the info shows up regardless of which path Agenda actually uses.
        // Day/Week grid chips ignore this and just show "Available" (see
        // renderCalendarEvent) since the grid position already conveys time.
        title: `Available: ${b.start.format("h:mm A")} – ${b.end.format("h:mm A")}`,
        start: b.start,
        end: b.end,
        color: PERSONAL_COLOR,
        backgroundColor: PERSONAL_COLOR,
        data: { layer: "personal", editable: true, source },
      };
    });
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

  // Inline availability editing (My Calendar / aggregate view) — see the
  // design note on why this is three unambiguous actions (add / mark day
  // unavailable / reset) rather than a single "replace today's hours"
  // action: overrides are purely additive-or-subtractive in
  // resolveAvailableBlocks, with no "replace" semantic, and same-day
  // overrides are order-dependent in a way this UI deliberately avoids
  // triggering rather than tries to fix.
  const [editingAvailability, setEditingAvailability] = useState<EditingAvailability | null>(null);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [availabilityEditMode, setAvailabilityEditMode] = useState<AvailabilityEditMode>("view");
  const [editingRecurring, setEditingRecurring] = useState<EditingRecurring | null>(null);
  const [savingRecurringEdit, setSavingRecurringEdit] = useState(false);
  const [viewingAvailability, setViewingAvailability] = useState<{
    start: dayjs.Dayjs;
    end: dayjs.Dayjs;
  } | null>(null);

  // Personal availability editing (click-edit, drag-edit, the mode toggle)
  // is only allowed in the aggregate view ("My Calendar", cohortId absent) —
  // which also covers the Settings → Availability embed, since that always
  // renders with no cohortId too. A specific cohort's calendar still shows
  // the Personal layer for context (so you can see your own availability
  // alongside that cohort's events), but it's read-only there — editing
  // your own schedule from inside someone else's cohort view doesn't make
  // sense as a place to do it. Forcing the *effective* mode to "view" here
  // (rather than only hiding the toggle button) is deliberate defense in
  // depth — hiding the toggle stops new mode changes, but doesn't protect
  // against stale mode state if this component ever received a changed
  // cohortId prop without a full remount.
  const personalEditingAllowed = !cohortId;
  const effectiveAvailabilityEditMode: AvailabilityEditMode = personalEditingAllowed
    ? availabilityEditMode
    : "view";

  // Moved inside the component (from module scope) specifically so this can
  // close over availabilityEditMode — renderEvent's call signature is just
  // (event) => ReactNode, with no way to thread extra context through the
  // prop itself, so closure is the only option for mode-aware styling. Must
  // sit after the useState calls above — it depends on availabilityEditMode
  // (via effectiveAvailabilityEditMode), and referencing that before its own
  // useState line executes throws a "Cannot access before initialization"
  // TDZ error (confirmed the hard way).
  const renderCalendarEvent = useCallback(
    (event: CalendarEvent) => {
      const data = getEventData(event);
      if (data.layer === "personal") {
        const source = data.source ?? "recurring";
        // Dimmed = this block's source doesn't match the active edit mode.
        // In "view" mode nothing is dimmed — there's no active edit to be
        // mismatched against yet, just informational display.
        const dimmed =
          effectiveAvailabilityEditMode !== "view" && effectiveAvailabilityEditMode !== source;
        return (
          <div
            style={{
              border: dimmed ? "1.5px dotted #cbd5e1" : "1.5px dashed #94a3b8",
              background: dimmed ? "rgba(148, 163, 184, 0.06)" : "transparent",
              borderRadius: 4,
              padding: "2px 6px",
              fontSize: 12,
              color: dimmed ? "#cbd5e1" : "#475569",
              height: "100%",
              boxSizing: "border-box",
              overflow: "hidden",
              cursor: dimmed ? "not-allowed" : undefined,
            }}
          >
            Available
          </div>
        );
      }
      return (
        <div
          style={{
            background: event.backgroundColor ?? hexToRgba(GROUP_COLOR, 0.14),
            borderLeft: `3px solid ${event.color ?? GROUP_COLOR}`,
            color: event.color ?? GROUP_COLOR,
            fontWeight: 600,
            borderRadius: 4,
            padding: "2px 6px",
            fontSize: 12,
            height: "100%",
            boxSizing: "border-box",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {event.title}
        </div>
      );
    },
    [effectiveAvailabilityEditMode]
  );

  function closeModal() {
    setSelectedEvent(null);
    setEditing(false);
    setCreatingNew(false);
  }

  function openCreateModal(range?: { start: dayjs.Dayjs; end: dayjs.Dayjs }) {
    if (!cohortId) return;
    const start = range?.start ?? dayjs().add(1, "hour").startOf("hour");
    const end = range?.end ?? start.add(1, "hour");
    setEditTitle("");
    setEditDescription("");
    setEditLocation("");
    setEditStart(start.format("YYYY-MM-DDTHH:mm"));
    setEditEnd(end.format("YYYY-MM-DDTHH:mm"));
    setEditColor(COLOR_PRESETS[0]);
    setEditChatGraceHours(0);
    setSelectedEvent(null);
    setEditing(true);
    setCreatingNew(true);
  }

  const handleCreateNew = useCallback(async () => {
    if (!cohortId || !currentUserId) return;
    setSavingEdit(true);
    setError(null);
    try {
      const newStart = dayjs(editStart);
      const newEnd = dayjs(editEnd);
      const inserted = await insertEvent({
        cohort_id: cohortId,
        created_by: currentUserId,
        title: editTitle || "Untitled event",
        description: editDescription || null,
        location: editLocation || null,
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString(),
        color: editColor,
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
        console.error("Event created, but its chat could not be created:", chatErr);
        setError("Event created, but its chat couldn't be set up.");
      }

      const mapped = groupRowToCalendarEvent(inserted, currentUserId);
      if (mapped) {
        setGroupEvents((prev) => [...prev, { ...mapped, data: { ...mapped.data, chatId } }]);
      }
      closeModal();
    } catch (err) {
      console.error("Failed to create event:", err);
      const message = err instanceof Error ? err.message : "Couldn't create the event. Try again.";
      setError(message);
      showErrorToast(message);
    } finally {
      setSavingEdit(false);
    }
  }, [cohortId, currentUserId, editTitle, editDescription, editLocation, editStart, editEnd, editColor]);

  /**
   * Drag/resize on a personal availability block, gated by the active edit
   * mode (see AvailabilityEditMode). A block whose source doesn't match the
   * active mode gets no interaction at all — silently reverts, no toast —
   * matching the dimmed visual treatment in renderCalendarEvent, which is
   * what communicates "not editable right now" rather than a message on
   * every attempted drag. "view" mode reverts everything, but does surface
   * a one-time-per-attempt hint toast, since there's no dimming to lean on
   * when no mode is active yet.
   *
   * Scoped deliberately within each matching mode: only days with exactly
   * one resolved block of that source are draggable — a day with several
   * overlapping windows of the same type has no safe way to know *which*
   * displayed block was grabbed without deeper provenance tracking than
   * resolveAvailableBlocks carries today. Those stay revert-on-drop, same
   * mechanism, pointing at click-to-edit instead.
   *
   * A successful drag in "oneoff" mode creates/replaces a one-off override
   * for that specific date — never the recurring pattern. A successful drag
   * in "recurring" mode updates the underlying recurring rule directly,
   * which affects every matching weekday going forward, not just this date
   * — that's the whole point of choosing Recurring mode explicitly rather
   * than it happening by accident.
   */
  const handlePersonalDrag = useCallback(
    async (updated: CalendarEvent, original: PocCalendarEvent | undefined) => {
      const data = getEventData(updated);
      const source = data.source ?? "recurring";
      const eventId = String(updated.id);
      const newStart = dayjs(updated.start);
      const newEnd = dayjs(updated.end);
      const alreadyAtOriginal =
        !!original && newStart.isSame(original.start) && newEnd.isSame(original.end);

      // Same lesson as the group-event revert fix earlier this session:
      // calling ilamyApiRef.current.updateEvent() re-fires this same
      // callback as a notification of the correction — if the incoming
      // position already matches `original`, this call *is* that
      // notification, so do nothing instead of correcting again.
      function silentRevert() {
        if (alreadyAtOriginal) return;
        if (original) {
          ilamyApiRef.current?.updateEvent(eventId, { start: original.start, end: original.end });
        }
      }

      // Mode/source mismatch — no interaction, per the edit-mode toggle
      // design. The dimmed styling already told the user this block isn't
      // editable right now; no need to also toast on every attempt. Also
      // covers the cohort-scoped case: effectiveAvailabilityEditMode is
      // forced to "view" whenever personalEditingAllowed is false, so this
      // branch (or the "view" branch just below) always wins there
      // regardless of whatever availabilityEditMode's raw state happens
      // to hold.
      if (effectiveAvailabilityEditMode !== "view" && effectiveAvailabilityEditMode !== source) {
        silentRevert();
        return;
      }

      if (effectiveAvailabilityEditMode === "view") {
        if (!alreadyAtOriginal) {
          silentRevert();
          if (personalEditingAllowed) {
            showErrorToast('Turn on "Edit: Recurring" or "Edit: One-off" above to drag availability blocks.');
          }
          // No toast in the cohort-scoped case — there's no toggle to point
          // at here, so a hint would be misleading; the silent revert alone
          // is correct.
        }
        return;
      }

      if (alreadyAtOriginal) return;

      if (effectiveAvailabilityEditMode === "recurring") {
        const dow = newStart.day();
        const rowsForDay = recurring.filter((r) => r.day_of_week === dow);
        if (rowsForDay.length !== 1) {
          silentRevert();
          showErrorToast(
            "This day has more than one recurring rule — edit it from Settings → Availability instead."
          );
          return;
        }
        try {
          await updateRecurringAvailability(rowsForDay[0].id, {
            start_time: newStart.format("HH:mm:ss"),
            end_time: newEnd.format("HH:mm:ss"),
          });
          const rows = await fetchRecurringAvailability();
          setRecurring(rows);
        } catch (err) {
          console.error("Failed to update recurring availability:", err);
          silentRevert();
          showErrorToast("Couldn't save that change. Try again.");
        }
        return;
      }

      // effectiveAvailabilityEditMode === "oneoff"
      if (!currentUserId) {
        silentRevert();
        return;
      }
      const date = newStart.format("YYYY-MM-DD");
      const dayBlockCount = personalEvents.filter(
        (e) => dayjs(e.start).format("YYYY-MM-DD") === date
      ).length;
      if (dayBlockCount > 1) {
        silentRevert();
        showErrorToast("This day has more than one availability window — click it instead to edit them.");
        return;
      }
      try {
        const existingForDate = overrides.filter((o) => o.override_date === date);
        for (const row of existingForDate) {
          await deleteAvailabilityOverride(row.id);
        }
        await insertAvailabilityOverride({
          user_id: currentUserId,
          override_date: date,
          start_time: newStart.format("HH:mm:ss"),
          end_time: newEnd.format("HH:mm:ss"),
          timezone: dayjs.tz.guess(),
          is_available: true,
        });
        const rows = await fetchAvailabilityOverrides(
          visibleRange.start.format("YYYY-MM-DD"),
          visibleRange.end.format("YYYY-MM-DD")
        );
        setOverrides(rows);
      } catch (err) {
        console.error("Failed to save dragged availability:", err);
        silentRevert();
        showErrorToast("Couldn't save that change. Try again.");
      }
    },
    [
      effectiveAvailabilityEditMode,
      personalEditingAllowed,
      recurring,
      personalEvents,
      currentUserId,
      overrides,
      visibleRange,
    ]
  );

  const handleEventUpdate = useCallback(
    async (updated: CalendarEvent) => {
      const data = getEventData(updated);
      const eventId = String(updated.id);
      const original = [...groupEvents, ...personalEvents].find((e) => String(e.id) === eventId);

      if (data.layer === "personal") {
        await handlePersonalDrag(updated, original);
        return;
      }

      // Only group events have a real "completed" concept — personal
      // availability blocks aren't calendar commitments with an end state.
      const completed = !!original && hasEnded(original.end);

      if (!data.editable || completed) {
        const updatedStart = dayjs(updated.start);
        const updatedEnd = dayjs(updated.end);
        // Calling ilamyApiRef.current.updateEvent() below appears to re-fire
        // this same onEventUpdate callback as a notification of the
        // correction — without this guard, that recurses forever (confirmed
        // via a real "Maximum call stack size exceeded" crash). If the
        // incoming position already matches `original`, this call *is* that
        // notification — do nothing instead of correcting again.
        const alreadyReverted =
          !!original && updatedStart.isSame(original.start) && updatedEnd.isSame(original.end);

        if (!alreadyReverted) {
          console.warn(
            completed ? "Blocked move: event has already ended." : "Blocked move: event is view-only.",
            eventId
          );
          if (original) {
            ilamyApiRef.current?.updateEvent(eventId, { start: original.start, end: original.end });
          }
          if (completed) {
            showErrorToast("This event has already ended and can't be edited.");
          }
        }
        return;
      }

      const newStart = dayjs(updated.start);
      const newEnd = dayjs(updated.end);

      let previous: { start: dayjs.Dayjs; end: dayjs.Dayjs } | null = null;
      setGroupEvents((prev) =>
        prev.map((e) => {
          if (String(e.id) !== eventId) return e;
          previous = { start: e.start, end: e.end };
          return { ...e, start: newStart, end: newEnd };
        })
      );

      try {
        await updateEvent(eventId, {
          starts_at: newStart.toISOString(),
          ends_at: newEnd.toISOString(),
        });
      } catch (err) {
        console.error("Failed to persist event move:", err);
        const message =
          err instanceof Error
            ? err.message
            : "Couldn't save that change."; //  (Check that 012_events_update_policy.sql has been applied.)
        setError(message);
        showErrorToast(message);

        // Snap back to the last DB-confirmed position instead of leaving the
        // failed optimistic move on screen until a reload fixes it.
        if (previous) {
          const { start, end } = previous;
          setGroupEvents((prev) =>
            prev.map((e) => (String(e.id) === eventId ? { ...e, start, end } : e))
          );
          ilamyApiRef.current?.updateEvent(eventId, { start, end });
        }
      }
    },
    [groupEvents, personalEvents, handlePersonalDrag]
  );

  const handleEventAdd = useCallback(
    async (added: CalendarEvent) => {
      // events.cohort_id is NOT NULL — there's no valid cohort to attach a
      // new event to on the aggregate view. This is now the only guard
      // against that (isCellDisabled was removed — cells need to stay
      // clickable in aggregate view for inline availability editing, and
      // this check alone is sufficient since drag-select-to-create routes
      // through this same handler regardless of cell state).
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

  const handleDateChange = useCallback(
    (_date: dayjs.Dayjs, range: { start: dayjs.Dayjs; end: dayjs.Dayjs }) => {
      setVisibleRange({ start: range.start, end: range.end });
    },
    []
  );

  const handleEventClick = useCallback(
    (clicked: CalendarEvent) => {
      const data = getEventData(clicked);
      if (data.layer === "personal") {
        if (!personalEditingAllowed) {
          // A specific cohort's calendar — availability is shown for
          // context, not editable here. Read-only info only.
          setViewingAvailability({ start: dayjs(clicked.start), end: dayjs(clicked.end) });
          return;
        }

        const source = data.source ?? "recurring";
        const mismatched =
          effectiveAvailabilityEditMode !== "view" && effectiveAvailabilityEditMode !== source;
        if (mismatched) return; // no interaction — matches drag's gating

        if (source === "recurring") {
          const dow = dayjs(clicked.start).day();
          const rowsForDay = recurring.filter((r) => r.day_of_week === dow);
          if (rowsForDay.length !== 1) {
            showErrorToast(
              "This day has more than one recurring rule — edit it from Settings → Availability instead."
            );
            return;
          }
          const row = rowsForDay[0];
          setEditingRecurring({
            dayOfWeek: dow,
            rowId: row.id,
            start: row.start_time.slice(0, 5),
            end: row.end_time.slice(0, 5),
          });
          return;
        }

        const date = dayjs(clicked.start).format("YYYY-MM-DD");
        setEditingAvailability({
          date,
          start: dayjs(clicked.start).format("HH:mm"),
          end: dayjs(clicked.end).format("HH:mm"),
          hasExistingOverrides: overrides.some((o) => o.override_date === date),
        });
        return;
      }
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
      setCreatingNew(false);
      setModalTab("details");
    },
    [overrides, recurring, personalEditingAllowed, effectiveAvailabilityEditMode]
  );

  // Branches on cohortId: a specific cohort's calendar creates a group
  // event (unchanged behavior); the aggregate "My Calendar" view has no
  // cohort to attach an event to, so an empty-cell click there starts
  // adding an availability window instead.
  const handleCellClick = useCallback(
    (info: CellInfo) => {
      if (cohortId) {
        openCreateModal({ start: info.start, end: info.end });
        return;
      }
      const date = info.start.format("YYYY-MM-DD");
      setEditingAvailability({
        date,
        start: info.start.format("HH:mm"),
        end: info.end.format("HH:mm"),
        hasExistingOverrides: overrides.some((o) => o.override_date === date),
      });
    },
    [cohortId, overrides]
  );

  const handleAddAvailabilityWindow = useCallback(async () => {
    if (!editingAvailability || !currentUserId) return;
    setSavingAvailability(true);
    setError(null);
    try {
      await insertAvailabilityOverride({
        user_id: currentUserId,
        override_date: editingAvailability.date,
        start_time: `${editingAvailability.start}:00`,
        end_time: `${editingAvailability.end}:00`,
        timezone: dayjs.tz.guess(),
        is_available: true,
      });
      const rows = await fetchAvailabilityOverrides(
        visibleRange.start.format("YYYY-MM-DD"),
        visibleRange.end.format("YYYY-MM-DD")
      );
      setOverrides(rows);
      setEditingAvailability(null);
    } catch (err) {
      console.error("Failed to add availability window:", err);
      const message = err instanceof Error ? err.message : "Couldn't save that. Try again.";
      setError(message);
      showErrorToast(message);
    } finally {
      setSavingAvailability(false);
    }
  }, [editingAvailability, currentUserId, visibleRange]);

  const handleMarkDayUnavailable = useCallback(async () => {
    if (!editingAvailability || !currentUserId) return;
    setSavingAvailability(true);
    setError(null);
    try {
      // Clear any existing overrides for this date first, so the resulting
      // whole-day is_available:false row is the only one — deliberately
      // avoids the same-day multi-override ordering ambiguity in
      // resolveAvailableBlocks rather than risking it.
      const existing = overrides.filter((o) => o.override_date === editingAvailability.date);
      for (const row of existing) {
        await deleteAvailabilityOverride(row.id);
      }
      await insertAvailabilityOverride({
        user_id: currentUserId,
        override_date: editingAvailability.date,
        start_time: null,
        end_time: null,
        timezone: dayjs.tz.guess(),
        is_available: false,
      });
      const rows = await fetchAvailabilityOverrides(
        visibleRange.start.format("YYYY-MM-DD"),
        visibleRange.end.format("YYYY-MM-DD")
      );
      setOverrides(rows);
      setEditingAvailability(null);
    } catch (err) {
      console.error("Failed to mark day unavailable:", err);
      const message = err instanceof Error ? err.message : "Couldn't save that. Try again.";
      setError(message);
      showErrorToast(message);
    } finally {
      setSavingAvailability(false);
    }
  }, [editingAvailability, currentUserId, overrides, visibleRange]);

  const handleResetAvailability = useCallback(async () => {
    if (!editingAvailability) return;
    setSavingAvailability(true);
    setError(null);
    try {
      const existing = overrides.filter((o) => o.override_date === editingAvailability.date);
      for (const row of existing) {
        await deleteAvailabilityOverride(row.id);
      }
      const rows = await fetchAvailabilityOverrides(
        visibleRange.start.format("YYYY-MM-DD"),
        visibleRange.end.format("YYYY-MM-DD")
      );
      setOverrides(rows);
      setEditingAvailability(null);
    } catch (err) {
      console.error("Failed to reset availability:", err);
      const message = err instanceof Error ? err.message : "Couldn't reset that. Try again.";
      setError(message);
      showErrorToast(message);
    } finally {
      setSavingAvailability(false);
    }
  }, [editingAvailability, overrides, visibleRange]);

  const handleSaveRecurringEdit = useCallback(async () => {
    if (!editingRecurring) return;
    setSavingRecurringEdit(true);
    setError(null);
    try {
      await updateRecurringAvailability(editingRecurring.rowId, {
        start_time: `${editingRecurring.start}:00`,
        end_time: `${editingRecurring.end}:00`,
      });
      const rows = await fetchRecurringAvailability();
      setRecurring(rows);
      setEditingRecurring(null);
    } catch (err) {
      console.error("Failed to save recurring availability:", err);
      const message = err instanceof Error ? err.message : "Couldn't save that. Try again.";
      setError(message);
      showErrorToast(message);
    } finally {
      setSavingRecurringEdit(false);
    }
  }, [editingRecurring]);

  const handleDeleteRecurringRule = useCallback(async () => {
    if (!editingRecurring) return;
    setSavingRecurringEdit(true);
    setError(null);
    try {
      await deleteRecurringAvailability(editingRecurring.rowId);
      const rows = await fetchRecurringAvailability();
      setRecurring(rows);
      setEditingRecurring(null);
    } catch (err) {
      console.error("Failed to remove recurring rule:", err);
      const message = err instanceof Error ? err.message : "Couldn't remove that. Try again.";
      setError(message);
      showErrorToast(message);
    } finally {
      setSavingRecurringEdit(false);
    }
  }, [editingRecurring]);

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
      if (hasEnded(selectedEvent.end)) {
        showErrorToast("This event has already ended — RSVPs are closed.");
        return;
      }
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
    if (hasEnded(selectedEvent.end)) {
      showErrorToast("This event has already ended and can't be edited.");
      return;
    }
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
    if (hasEnded(selectedEvent.end)) {
      showErrorToast("This event has already ended and can't be edited.");
      closeModal();
      return;
    }
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
                // Fixed: was previously `backgroundColor: editColor` (solid),
                // which mismatched the two-tone rendering everywhere else
                // until the next full reload recomputed it correctly.
                color: editColor,
                backgroundColor: hexToRgba(editColor, 0.14),
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
      closeModal();
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
      closeModal();
    } catch (err) {
      console.error("Failed to delete event:", err);
      const message =
        err instanceof Error
          ? err.message
          : "Couldn't delete that event. Try again."; // (Check that 015_events_delete_policy.sql has been applied.)
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
      {!hideHeader && (
        <>
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
              ? "Events for this cohort only. Your availability is shown for context, but only editable from My Calendar or Settings → Availability."
              : "Your availability (click a slot to add or edit), plus events and RSVPs across all your cohorts — open a specific cohort's calendar to create new events."}
          </p>
        </>
      )}

      {personalEditingAllowed && visibleLayers.personal && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--color-ink-faint)]">Availability editing:</span>
          <Button
            variant={availabilityEditMode === "view" ? "primary" : "secondary"}
            onClick={() => setAvailabilityEditMode("view")}
          >
            View only
          </Button>
          <Button
            variant={availabilityEditMode === "recurring" ? "primary" : "secondary"}
            onClick={() => setAvailabilityEditMode("recurring")}
          >
            Edit: Recurring
          </Button>
          <Button
            variant={availabilityEditMode === "oneoff" ? "primary" : "secondary"}
            onClick={() => setAvailabilityEditMode("oneoff")}
          >
            Edit: One-off
          </Button>
          {availabilityEditMode !== "view" && (
            <span className="text-xs text-[var(--color-ink-faint)]">
              Dimmed blocks below are the other type — switch modes to edit those instead.
            </span>
          )}
        </div>
      )}

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
            onCellClick={handleCellClick}
            scrollTime="08:00:00"
            timeFormat={timeFormat}
            renderEvent={renderCalendarEvent}
            renderCurrentTimeIndicator={renderCurrentTimeIndicator}
            headerComponent={
              <>
                <CustomCalendarHeader canCreateEvents={Boolean(cohortId)} onNewEvent={openCreateModal} />
                <CalendarApiBridge apiRef={ilamyApiRef} />
              </>
            }
          />
        </div>
      )}

      {(selectedEvent || creatingNew) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeModal}
        >
          <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            {creatingNew ? (
              <>
                <h2 className="font-display text-lg">New event</h2>
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
                            backgroundColor: hexToRgba(c, 0.35),
                            borderColor: editColor === c ? "var(--color-ink)" : "transparent",
                          }}
                          aria-label={`Color ${c}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="secondary" onClick={closeModal} disabled={savingEdit}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleCreateNew} disabled={savingEdit}>
                    {savingEdit ? "Saving…" : "Create"}
                  </Button>
                </div>
              </>
            ) : selectedEvent && !editing ? (
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
                {hasEnded(selectedEvent.end) && (
                  <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                    This event has ended — RSVPs and edits are closed.
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
                  <Button variant="secondary" onClick={closeModal}>
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
            ) : selectedEvent ? (
              <>
                <h2 className="font-display text-lg">Edit event</h2>
                {selectedEvent.data.cohortName && (
                  <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                    {selectedEvent.data.cohortName as string}
                  </p>
                )}
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
                            backgroundColor: hexToRgba(c, 0.35),
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
            ) : null}
          </Card>
        </div>
      )}

      {viewingAvailability && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setViewingAvailability(null)}
        >
          <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg">Available</h2>
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              {viewingAvailability.start.format("ddd, MMM D, h:mm A")} –{" "}
              {viewingAvailability.end.format("h:mm A")}
            </p>
            <p className="mt-2 text-sm text-[var(--color-ink-faint)]">
              Manage your availability from My Calendar or Settings → Availability.
            </p>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={() => setViewingAvailability(null)}>
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}

      {editingRecurring && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEditingRecurring(null)}
        >
          <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg">Edit recurring availability</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              Every {DAY_LABELS[editingRecurring.dayOfWeek]} — this changes your regular weekly
              pattern, not just this one day.
            </p>

            <div className="mt-4 flex gap-2">
              <div className="flex-1">
                <Label>From</Label>
                <Input
                  type="time"
                  value={editingRecurring.start}
                  onChange={(e) =>
                    setEditingRecurring((prev) => (prev ? { ...prev, start: e.target.value } : prev))
                  }
                />
              </div>
              <div className="flex-1">
                <Label>Until</Label>
                <Input
                  type="time"
                  value={editingRecurring.end}
                  onChange={(e) =>
                    setEditingRecurring((prev) => (prev ? { ...prev, end: e.target.value } : prev))
                  }
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setEditingRecurring(null)}
                disabled={savingRecurringEdit}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={handleDeleteRecurringRule} disabled={savingRecurringEdit}>
                Remove this day
              </Button>
              <Button variant="primary" onClick={handleSaveRecurringEdit} disabled={savingRecurringEdit}>
                {savingRecurringEdit ? "Saving…" : "Save"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {editingAvailability && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setEditingAvailability(null)}
        >
          <Card className="w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg">Edit availability</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              {dayjs(editingAvailability.date).format("dddd, MMM D, YYYY")}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label>New window: from</Label>
                  <Input
                    type="time"
                    value={editingAvailability.start}
                    onChange={(e) =>
                      setEditingAvailability((prev) => (prev ? { ...prev, start: e.target.value } : prev))
                    }
                  />
                </div>
                <div className="flex-1">
                  <Label>Until</Label>
                  <Input
                    type="time"
                    value={editingAvailability.end}
                    onChange={(e) =>
                      setEditingAvailability((prev) => (prev ? { ...prev, end: e.target.value } : prev))
                    }
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--color-ink-faint)]">
                Adding a window here sets your availability for this one day — once you've added
                anything for this date, it replaces your regular weekly pattern for just this day
                (not other days). Add another window afterward if you want more than one range
                today. You can also drag a block directly on the calendar while "Edit: One-off" is
                selected above — or "Edit: Recurring" to change your regular weekly pattern instead.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setEditingAvailability(null)}
                disabled={savingAvailability}
              >
                Cancel
              </Button>
              {editingAvailability.hasExistingOverrides && (
                <Button variant="secondary" onClick={handleResetAvailability} disabled={savingAvailability}>
                  Reset to usual schedule
                </Button>
              )}
              <Button variant="danger" onClick={handleMarkDayUnavailable} disabled={savingAvailability}>
                Mark whole day unavailable
              </Button>
              <Button variant="primary" onClick={handleAddAvailabilityWindow} disabled={savingAvailability}>
                {savingAvailability ? "Saving…" : "Add window"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete this event?"
        body={
          selectedEvent?.data.cohortName
            ? `This can't be undone. This deletes "${
                (selectedEvent.data.rawTitle as string) ?? selectedEvent.title
              }" from ${selectedEvent.data.cohortName as string} — anyone who RSVP'd will lose access to it.`
            : "This can't be undone. Anyone who RSVP'd will lose access to it."
        }
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        cancelLabel="Cancel"
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
      />

      <ToastHost />
    </Card>
  );
}