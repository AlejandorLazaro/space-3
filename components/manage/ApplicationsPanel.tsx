"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui";
import ApplicationQueue from "@/components/ApplicationQueue";
import type { Application } from "@/lib/types";

export default function ApplicationsPanel({ cohortId }: { cohortId: string }) {
  const [loading, setLoading] = useState(true);
  const [pendingApplications, setPendingApplications] = useState<Application[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: appRows, error: appError } = await supabase
      .from("applications")
      .select("*, profiles!applicant_id(display_name)")
      .eq("cohort_id", cohortId)
      .eq("status", "pending")
      .order("submitted_at", { ascending: true });

    if (appError) {
      console.error("Failed to load applications:", appError);
      setError(true);
    }
    setPendingApplications((appRows ?? []) as unknown as Application[]);
    setLoading(false);
  }, [cohortId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return null;

  return (
    <div>
      <h2 className="font-mono-tag mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
        Pending ({pendingApplications.length})
      </h2>
      {error ? (
        <Card className="p-8 text-center">
          <p className="text-[var(--color-danger)]">
            Couldn&rsquo;t load applications. Check the console — this is usually an RLS or
            query error, not an empty list.
          </p>
        </Card>
      ) : pendingApplications.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[var(--color-ink-soft)]">No pending applications right now.</p>
        </Card>
      ) : (
        <ApplicationQueue applications={pendingApplications} onReviewed={load} />
      )}
    </div>
  );
}