"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Cohort, Application } from "@/lib/types";
import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui";
import ApplicationQueue from "@/components/ApplicationQueue";
import RequireAuth from "@/components/RequireAuth";

function ApplicationsPageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");

  const [loading, setLoading] = useState(true);
  const [notFoundState, setNotFoundState] = useState(false);
  const [notMember, setNotMember] = useState(false);
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [pendingApplications, setPendingApplications] = useState<Application[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) {
      setNotFoundState(true);
      setLoading(false);
      return;
    }

    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: cohortData } = await supabase
        .from("cohorts")
        .select("*")
        .eq("id", id)
        .single();

      if (!cohortData) {
        setNotFoundState(true);
        setLoading(false);
        return;
      }
      setCohort(cohortData as Cohort);

      const { data: membership } = await supabase
        .from("cohort_memberships")
        .select("*")
        .eq("cohort_id", id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      if (!membership) {
        // Not a member — nothing to manage, and RLS would block the query below anyway.
        setNotMember(true);
        setLoading(false);
        return;
      }

      const { data: appRows, error: appError } = await supabase
        .from("applications")
        .select("*, profiles!applicant_id(display_name)")
        .eq("cohort_id", id)
        .eq("status", "pending")
        .order("submitted_at", { ascending: true });

      if (appError) {
        console.error("Failed to load applications:", appError);
        setError(true);
      }

      setPendingApplications((appRows ?? []) as unknown as Application[]);
      setLoading(false);
    })();
  }, [id]);

  if (loading) return null; // or a skeleton

  if (notFoundState || notMember || !cohort) {
    return (
      <div className="min-h-screen bg-[var(--color-fog)]">
        <TopBar />
        <main className="mx-auto max-w-2xl px-5 py-8">
          <Card className="p-8 text-center">
            <p className="text-[var(--color-ink-soft)]">
              {notMember ? "You don't have access to this page." : "Cohort not found."}
            </p>
            <Link href="/groups" className="mt-3 inline-block text-sm underline">
              ← All cohorts
            </Link>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <RequireAuth>
        <div className="min-h-screen bg-[var(--color-fog)]">
        <TopBar />
        <main className="mx-auto max-w-2xl px-5 py-8">
            <Link
            href={`/groups/detail?id=${cohort.id}`}
            className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
            >
            ← {cohort.name}
            </Link>

            <h1 className="font-display mt-3 mb-6 text-2xl">
            Applications ({pendingApplications.length})
            </h1>

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
            <ApplicationQueue applications={pendingApplications} />
            )}
        </main>
        </div>
    </RequireAuth>
  );
}

export default function ApplicationsPage() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <ApplicationsPageInner />
    </Suspense>
  );
}
