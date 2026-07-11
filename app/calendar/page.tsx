"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import TopBar from "@/components/TopBar";
import CohortCalendarPoc from "@/components/calendar/CohortCalendarPoc";

function CalendarPageInner() {
  const searchParams = useSearchParams();
  const cohortId = searchParams.get("cohortId") ?? undefined;
  const eventId = searchParams.get("eventId") ?? undefined;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <CohortCalendarPoc cohortId={cohortId} initialEventId={eventId} />
    </main>
  );
}

export default function CalendarPage() {
  return (
    <RequireAuth>
      <TopBar />
      <Suspense
        fallback={
          <main className="mx-auto max-w-5xl px-4 py-8 text-sm text-[var(--color-ink-faint)]">
            Loading…
          </main>
        }
      >
        <CalendarPageInner />
      </Suspense>
    </RequireAuth>
  );
}