"use client";

import dayjs from "dayjs";
import { useIlamyCalendarContext } from "@ilamy/calendar";
import { Button } from "@/components/ui";

/**
 * Replaces ilamy's default header (via `headerComponent`) so Year can be
 * dropped from the view switcher without CSS against Radix's portaled,
 * unscopable dropdown markup, and so "+ New" opens our own create modal
 * (with our 6-preset color system) instead of ilamy's built-in event form
 * — see the calendar UI pass discussion for why. Filters views by name via
 * getViews(), so this stays correct even if ilamy reorders or adds views in
 * a future release (unlike a positional CSS rule).
 *
 * Deliberately dropped vs. the original default header (explicit product
 * decisions, not oversights):
 * - Date-range title is plain text, not a click-to-jump date-picker popover
 *   — no date-picker primitive is exposed via useIlamyCalendarContext().
 * - No Export button — redundant with the app's own subscribable webcal
 *   feed (Settings → Calendar feed; see space3-calendar-feature-TODO.md).
 *
 * Assumption not yet visually confirmed: that IlamyCalendar renders
 * `headerComponent` inside its own context provider tree, so
 * useIlamyCalendarContext() resolves here. If this throws a "must be used
 * within a provider" error, that assumption was wrong and this needs a
 * different mounting approach.
 */
interface CustomCalendarHeaderProps {
  /** Mirrors CohortCalendarPoc's own isCellDisabled gating — creation is blocked in the aggregate (all-cohorts) view. */
  canCreateEvents: boolean;
  /** Opens CohortCalendarPoc's own create modal — replaces ilamy's built-in openEventForm() call. */
  onNewEvent: () => void;
}

function formatRangeTitle(start: dayjs.Dayjs, end: dayjs.Dayjs): string {
  const sameDay = start.isSame(end, "day");
  const sameMonth = start.isSame(end, "month");
  const sameYear = start.isSame(end, "year");

  if (sameDay) return start.format("MMM D, YYYY");
  if (sameMonth) return `${start.format("MMM D")} – ${end.format("D, YYYY")}`;
  if (sameYear) return `${start.format("MMM D")} – ${end.format("MMM D, YYYY")}`;
  return `${start.format("MMM D, YYYY")} – ${end.format("MMM D, YYYY")}`;
}

export default function CustomCalendarHeader({ canCreateEvents, onNewEvent }: CustomCalendarHeaderProps) {
  const { currentRange, view, setView, nextPeriod, prevPeriod, today, getViews, t } =
    useIlamyCalendarContext();

  // The one line doing the actual job this component exists for.
  const views = getViews().filter((v) => v.name !== "year");

  return (
    <div className="flex flex-col items-center gap-2 @lg:flex-row @lg:justify-between p-1 mb-1">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-9 items-center gap-1 rounded-lg border border-[var(--color-line)]">
          <Button variant="secondary" onClick={prevPeriod} aria-label="Previous">
            ‹
          </Button>
          <Button variant="secondary" onClick={nextPeriod} aria-label="Next">
            ›
          </Button>
        </div>
        <Button variant="secondary" onClick={today}>
          Today
        </Button>
        <span
          className="px-2 text-sm font-semibold text-[var(--color-ink)]"
          style={{
            width: 230,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "inline-block",
          }}
        >
          {formatRangeTitle(currentRange.start, currentRange.end)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div
          role="radiogroup"
          className="flex flex-wrap items-center gap-0.5 rounded-lg bg-[var(--color-paper)] border border-[var(--color-line)] p-0.75"
        >
          {views.map((v) => {
            const active = v.name === view;
            return (
              <button
                key={v.name}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setView(v.name)}
                className={
                  "rounded-md px-3 h-8 text-sm font-medium transition-colors " +
                  (active
                    ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                    : "bg-transparent text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]")
                }
              >
                {v.label ? t(v.label) : v.name}
              </button>
            );
          })}
        </div>

        <Button
          variant="primary"
          onClick={onNewEvent}
          disabled={!canCreateEvents}
          aria-label="New"
          title={canCreateEvents ? undefined : "Open a specific cohort's calendar to create events."}
        >
          + New
        </Button>
      </div>
    </div>
  );
}