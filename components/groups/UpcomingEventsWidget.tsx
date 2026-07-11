"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import { Card } from "@/components/ui";
import { fetchUpcomingEventsWithRsvpCounts, type UpcomingEventSummary } from "@/lib/calendar/events";

export default function UpcomingEventsWidget({ cohortId }: { cohortId: string }) {
  const [events, setEvents] = useState<UpcomingEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchUpcomingEventsWithRsvpCounts(cohortId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch((err) => {
        console.error("Failed to load upcoming events:", err);
        if (!cancelled) setError("Couldn't load upcoming events.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cohortId]);

  return (
    <div>
      <h2 className="font-mono-tag mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
        Upcoming events
      </h2>
      <Card className="divide-y divide-[var(--color-line)]">
        {loading ? (
          <p className="px-3 py-2 text-sm text-[var(--color-ink-faint)]">Loading…</p>
        ) : error ? (
          <p className="px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p>
        ) : events.length === 0 ? (
          <p className="px-3 py-2 text-sm text-[var(--color-ink-faint)]">No upcoming events.</p>
        ) : (
          events.map((e) => (
            <Link
              key={e.id}
              href={`/calendar?cohortId=${cohortId}&eventId=${e.id}`}
              className="block px-3 py-2 text-sm hover:bg-black/5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{e.title}</span>
                <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">
                  {dayjs(e.starts_at).format("MMM D, h:mm A")}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-[var(--color-ink-soft)]">
                Going: {e.going_count} · Maybe: {e.maybe_count}
              </div>
            </Link>
          ))
        )}
      </Card>
    </div>
  );
}