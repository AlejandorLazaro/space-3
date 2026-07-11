"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { createClient } from "@/lib/supabase/client";
import { Card, Tag, Button, Input, Label } from "@/components/ui";
import {
  fetchRecurringAvailability,
  fetchManagedOverrides,
  insertRecurringAvailability,
  deleteRecurringAvailability,
  insertAvailabilityOverride,
  deleteAvailabilityOverride,
  type RecurringAvailabilityRow,
  type AvailabilityOverrideRow,
} from "@/lib/calendar/availability";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIME_FORMAT_STORAGE_KEY = "space3.availabilityTimeFormat"; // "12" | "24"

function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function detectDefault12Hour(): boolean {
  try {
    return Intl.DateTimeFormat().resolvedOptions().hour12 ?? true;
  } catch {
    return true;
  }
}

/**
 * Formats a "HH:mm" or "HH:mm:ss" string (what's actually stored — native
 * <input type="time"> always stores 24-hour internally regardless of how it
 * visually displays, so there's no data bug here, only a display one).
 * `<input type="time">` itself can't be forced into 12h/24h display — that's
 * browser/OS-locale controlled and out of our hands — so this only affects
 * the list view below, which is fully under our control.
 */
function formatTime(hhmm: string, use12Hour: boolean): string {
  const parsed = dayjs(`2000-01-01 ${hhmm.slice(0, 5)}`);
  return parsed.format(use12Hour ? "h:mm A" : "HH:mm");
}

export default function AvailabilityPanel() {
  const [userId, setUserId] = useState<string | null>(null);
  const [recurring, setRecurring] = useState<RecurringAvailabilityRow[]>([]);
  const [overrides, setOverrides] = useState<AvailabilityOverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Recurring rule form
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [recurStart, setRecurStart] = useState("09:00");
  const [recurEnd, setRecurEnd] = useState("17:00");
  const [savingRecurring, setSavingRecurring] = useState(false);

  // Override form
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideAllDay, setOverrideAllDay] = useState(true);
  const [overrideStart, setOverrideStart] = useState("09:00");
  const [overrideEnd, setOverrideEnd] = useState("17:00");
  const [overrideAvailable, setOverrideAvailable] = useState(false); // default: "block this day out"
  const [overrideNote, setOverrideNote] = useState("");
  const [savingOverride, setSavingOverride] = useState(false);

  const timezone = detectedTimezone();

  const [use12Hour, setUse12Hour] = useState(detectDefault12Hour);

  useEffect(() => {
    const stored = window.localStorage.getItem(TIME_FORMAT_STORAGE_KEY);
    if (stored === "12") setUse12Hour(true);
    else if (stored === "24") setUse12Hour(false);
    // else: leave the locale-detected default from useState's initializer.
  }, []);

  function handleSetTimeFormat(use12: boolean) {
    setUse12Hour(use12);
    window.localStorage.setItem(TIME_FORMAT_STORAGE_KEY, use12 ? "12" : "24");
  }

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
        setUserId(user?.id ?? null);

        const [recurringRows, overrideRows] = await Promise.all([
          fetchRecurringAvailability(),
          fetchManagedOverrides(),
        ]);
        if (cancelled) return;
        setRecurring(recurringRows);
        setOverrides(overrideRows);
      } catch (err) {
        console.error("Failed to load availability settings:", err);
        if (!cancelled) setError("Couldn't load your availability settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAddRecurring() {
    if (!userId) return;
    if (recurEnd <= recurStart) {
      setError("End time must be after start time.");
      return;
    }
    setSavingRecurring(true);
    setError(null);
    try {
      const row = await insertRecurringAvailability({
        user_id: userId,
        day_of_week: dayOfWeek,
        start_time: recurStart,
        end_time: recurEnd,
        timezone,
      });
      setRecurring((prev) => [...prev, row]);
    } catch (err) {
      console.error("Failed to add recurring availability:", err);
      setError("Couldn't save that recurring window. Try again.");
    } finally {
      setSavingRecurring(false);
    }
  }

  async function handleDeleteRecurring(id: string) {
    const prev = recurring;
    setRecurring((r) => r.filter((row) => row.id !== id)); // optimistic
    try {
      await deleteRecurringAvailability(id);
    } catch (err) {
      console.error("Failed to delete recurring availability:", err);
      setError("Couldn't delete that — try again.");
      setRecurring(prev); // revert
    }
  }

  async function handleAddOverride() {
    if (!userId) return;
    if (!overrideDate) {
      setError("Pick a date for the override.");
      return;
    }
    if (!overrideAllDay && overrideEnd <= overrideStart) {
      setError("End time must be after start time.");
      return;
    }
    setSavingOverride(true);
    setError(null);
    try {
      const row = await insertAvailabilityOverride({
        user_id: userId,
        override_date: overrideDate,
        start_time: overrideAllDay ? null : overrideStart,
        end_time: overrideAllDay ? null : overrideEnd,
        timezone,
        is_available: overrideAvailable,
        note: overrideNote || null,
      });
      setOverrides((prev) =>
        [...prev, row].sort((a, b) => a.override_date.localeCompare(b.override_date))
      );
      setOverrideDate("");
      setOverrideNote("");
    } catch (err) {
      console.error("Failed to add availability override:", err);
      setError("Couldn't save that override. Try again.");
    } finally {
      setSavingOverride(false);
    }
  }

  async function handleDeleteOverride(id: string) {
    const prev = overrides;
    setOverrides((o) => o.filter((row) => row.id !== id)); // optimistic
    try {
      await deleteAvailabilityOverride(id);
    } catch (err) {
      console.error("Failed to delete availability override:", err);
      setError("Couldn't delete that — try again.");
      setOverrides(prev); // revert
    }
  }

  return (
    <Card className="mt-6 p-6">
      <h2 className="font-display text-xl">Availability</h2>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        Sets your personal availability layer on the calendar — private to you,
        never visible to cohort members. Detected timezone:{" "}
        <span className="font-mono-tag">{timezone}</span>.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-[var(--color-ink-faint)]">Time display:</span>
        <Button variant={!use12Hour ? "primary" : "secondary"} onClick={() => handleSetTimeFormat(false)}>
          Military (24h)
        </Button>
        <Button variant={use12Hour ? "primary" : "secondary"} onClick={() => handleSetTimeFormat(true)}>
          Standard (AM/PM)
        </Button>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
        Only affects how times are listed below — the time pickers themselves follow your browser's own locale setting, which isn't something a web page can override.
      </p>

      {error && (
        <p className="mt-3 text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-[var(--color-ink-faint)]">Loading…</p>
      ) : (
        <>
          {/* Recurring weekly baseline */}
          <div className="mt-6">
            <h3 className="font-mono-tag mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
              Weekly pattern
            </h3>

            {recurring.length > 0 && (
              <Card className="mb-3 divide-y divide-[var(--color-line)]">
                {recurring.map((row) => (
                  <div key={row.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>
                      {DAY_LABELS[row.day_of_week]} {formatTime(row.start_time, use12Hour)}–
                      {formatTime(row.end_time, use12Hour)}
                      <span className="ml-2 text-xs text-[var(--color-ink-faint)]">
                        ({row.timezone})
                      </span>
                    </span>
                    <Button variant="ghost" onClick={() => handleDeleteRecurring(row.id)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </Card>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label>Day</Label>
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className="rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm text-[var(--color-ink)]"
                >
                  {DAY_LABELS.map((label, i) => (
                    <option key={label} value={i}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>From</Label>
                <Input
                  type="time"
                  value={recurStart}
                  onChange={(e) => setRecurStart(e.target.value)}
                  className="w-32"
                />
              </div>
              <div>
                <Label>To</Label>
                <Input
                  type="time"
                  value={recurEnd}
                  onChange={(e) => setRecurEnd(e.target.value)}
                  className="w-32"
                />
              </div>
              <Button variant="primary" onClick={handleAddRecurring} disabled={savingRecurring}>
                {savingRecurring ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>

          {/* Date-specific overrides */}
          <div className="mt-8">
            <h3 className="font-mono-tag mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
              Exceptions
            </h3>

            {overrides.length > 0 && (
              <Card className="mb-3 divide-y divide-[var(--color-line)]">
                {overrides.map((row) => (
                  <div key={row.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      {row.override_date}
                      {row.start_time && row.end_time
                        ? ` ${formatTime(row.start_time, use12Hour)}–${formatTime(row.end_time, use12Hour)}`
                        : " (all day)"}
                      <Tag tone={row.is_available ? "teal" : "amber"}>
                        {row.is_available ? "available" : "blocked"}
                      </Tag>
                      {row.note && (
                        <span className="text-xs text-[var(--color-ink-faint)]">{row.note}</span>
                      )}
                    </span>
                    <Button variant="ghost" onClick={() => handleDeleteOverride(row.id)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </Card>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label>Date</Label>
                <Input
                  type="date"
                  value={overrideDate}
                  onChange={(e) => setOverrideDate(e.target.value)}
                  className="w-40"
                />
              </div>
              <div>
                <Label>Status</Label>
                <select
                  value={overrideAvailable ? "available" : "blocked"}
                  onChange={(e) => setOverrideAvailable(e.target.value === "available")}
                  className="rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm text-[var(--color-ink)]"
                >
                  <option value="blocked">Block this time</option>
                  <option value="available">Add availability</option>
                </select>
              </div>
              <label className="flex items-center gap-1.5 pb-2 text-sm text-[var(--color-ink-soft)]">
                <input
                  type="checkbox"
                  checked={overrideAllDay}
                  onChange={(e) => setOverrideAllDay(e.target.checked)}
                />
                All day
              </label>
              {!overrideAllDay && (
                <>
                  <div>
                    <Label>From</Label>
                    <Input
                      type="time"
                      value={overrideStart}
                      onChange={(e) => setOverrideStart(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <div>
                    <Label>To</Label>
                    <Input
                      type="time"
                      value={overrideEnd}
                      onChange={(e) => setOverrideEnd(e.target.value)}
                      className="w-32"
                    />
                  </div>
                </>
              )}
              <div className="min-w-[10rem] flex-1">
                <Label>Note (optional)</Label>
                <Input
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  placeholder="e.g. traveling"
                />
              </div>
              <Button variant="primary" onClick={handleAddOverride} disabled={savingOverride}>
                {savingOverride ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}