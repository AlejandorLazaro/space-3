"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Input, Label } from "@/components/ui";
import CohortCalendarPoc from "@/components/calendar/CohortCalendarPoc";
import {
  fetchRecurringAvailability,
  insertRecurringAvailability,
  deleteRecurringAvailability,
  type RecurringAvailabilityRow,
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

/** Same formatter as before — still used for the recurring-pattern list, which is unchanged. */
function formatTime(hhmm: string, use12Hour: boolean): string {
  const parsed = dayjs(`2000-01-01 ${hhmm.slice(0, 5)}`);
  return parsed.format(use12Hour ? "h:mm A" : "HH:mm");
}

/**
 * Date-specific exceptions moved from a row/text list into the inline
 * calendar-click editor built into CohortCalendarPoc (click a day to add a
 * window, mark it fully unavailable, or reset to the weekly pattern below).
 *
 * The weekly recurring pattern stays as a compact form here, unchanged —
 * a recurring rule ("every Monday 9-5") isn't tied to one date, so there's
 * no natural "click a spot on the calendar" gesture for it the way there is
 * for a one-off exception. Removing it here would leave no surface in the
 * app to set it at all.
 */
export default function AvailabilityPanel() {
  const [userId, setUserId] = useState<string | null>(null);
  const [recurring, setRecurring] = useState<RecurringAvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [recurStart, setRecurStart] = useState("09:00");
  const [recurEnd, setRecurEnd] = useState("17:00");
  const [savingRecurring, setSavingRecurring] = useState(false);

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

        const rows = await fetchRecurringAvailability();
        if (!cancelled) setRecurring(rows);
      } catch (err) {
        console.error("Failed to load recurring availability:", err);
        if (!cancelled) setError("Couldn't load your weekly pattern.");
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

  return (
    <Card className="mt-6 p-6">
      <h2 className="font-display text-xl">Availability</h2>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        Your weekly pattern below sets the recurring baseline. For one-off exceptions —
        a day off, extra hours, whatever — click a day on the calendar underneath to add,
        block, or reset it, or just drag a block directly to reshape it. It's the same
        "Personal" layer shown on your cohort calendars, private to you.
        Detected timezone: <span className="font-mono-tag">{timezone}</span>.
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

      {error && (
        <p className="mt-3 text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-[var(--color-ink-faint)]">Loading…</p>
      ) : (
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
      )}

      <div className="mt-8">
        <h3 className="font-mono-tag mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
          Exceptions — click a day below to add, block, or reset
        </h3>
        <CohortCalendarPoc
          defaultVisibleLayers={{ personal: true, group: false }}
          timeFormat={use12Hour ? "12-hour" : "24-hour"}
          hideHeader
        />
      </div>
    </Card>
  );
}