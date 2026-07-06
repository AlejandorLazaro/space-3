"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Cohort, Membership, Application } from "@/lib/types";
import TopBar from "@/components/TopBar";
import { Card, Tag, Button } from "@/components/ui";
import ApplyButton from "@/components/ApplyButton";
import RequireAuth from "@/components/RequireAuth";

export default function GroupsPage() {
  const [loading, setLoading] = useState(true);
  const [allCohorts, setAllCohorts] = useState<Cohort[]>([]);
  const [myMemberships, setMyMemberships] = useState<Membership[]>([]);
  const [myPendingApps, setMyPendingApps] = useState<Application[]>([]);

  useEffect(() => {
    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // No visibility filter needed here -- RLS's cohorts_select policy
      // already restricts this query to public cohorts plus any cohort the
      // caller is an active member of (see 002_cohort_privacy_rls.sql).
      // "My cohorts" vs. "Discover" below is purely a membership-based split
      // of the one query result, not a second, differently-filtered query.
      const [{ data: cohorts }, { data: memberships }, { data: applications }] =
        await Promise.all([
          supabase.from("cohorts").select("*").order("created_at", { ascending: false }),
          supabase
            .from("cohort_memberships")
            .select("*")
            .eq("user_id", user.id)
            .eq("status", "active"),
          supabase
            .from("applications")
            .select("*")
            .eq("applicant_id", user.id)
            .eq("status", "pending"),
        ]);

      setAllCohorts((cohorts ?? []) as Cohort[]);
      setMyMemberships((memberships ?? []) as Membership[]);
      setMyPendingApps((applications ?? []) as Application[]);
      setLoading(false);
    })();
  }, []);

  if (loading) return null; // or a skeleton

  const myCohortIds = new Set(myMemberships.map((m) => m.cohort_id));
  const pendingCohortIds = new Set(myPendingApps.map((a) => a.cohort_id));

  const myCohorts = allCohorts.filter((c) => myCohortIds.has(c.id));
  const discoverCohorts = allCohorts.filter((c) => !myCohortIds.has(c.id));

  return (
    <RequireAuth>
        <div className="min-h-screen bg-[var(--color-fog)]">
        <TopBar />
        <main className="mx-auto max-w-3xl px-5 py-8">
            <div className="mb-8 flex items-center justify-between">
            <h1 className="font-display text-2xl">My cohorts</h1>
            <div className="flex gap-2">
                <Link href="/join">
                <Button variant="ghost">Have an invite code?</Button>
                </Link>
                <Link href="/groups/new">
                <Button variant="secondary">+ New cohort</Button>
                </Link>
            </div>
            </div>

            {myCohorts.length === 0 ? (
            <Card className="p-8 text-center">
                <p className="text-[var(--color-ink-soft)]">
                You&rsquo;re not in any cohorts yet. Find one nearby or ask a friend to invite you.
                </p>
            </Card>
            ) : (
            <div className="mb-10 grid gap-3">
                {myCohorts.map((cohort) => (
                <Link key={cohort.id} href={`/groups/detail?id=${cohort.id}`}>
                    <Card className="flex items-center justify-between p-4 transition-colors hover:border-[var(--color-ink-faint)]">
                    <div>
                        <div className="flex items-center gap-2">
                        <h2 className="font-display text-lg">{cohort.name}</h2>
                        </div>
                        {cohort.description && (
                        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                            {cohort.description}
                        </p>
                        )}
                    </div>
                    <Tag>{cohort.context_type}</Tag>
                    </Card>
                </Link>
                ))}
            </div>
            )}

            <h2 className="font-display mb-4 text-xl">Discover</h2>
            {discoverCohorts.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-soft)]">
                No other cohorts yet — be the first to create one.
            </p>
            ) : (
            <div className="grid gap-3">
                {discoverCohorts.map((cohort) => (
                <Card key={cohort.id} className="flex items-center justify-between p-4">
                    <div>
                    <div className="flex items-center gap-2">
                        <h2 className="font-display text-lg">{cohort.name}</h2>
                        <Tag>{cohort.context_type}</Tag>
                        {cohort.admission_mode === "invite_only" && (
                        <Tag tone="amber">invite only</Tag>
                        )}
                    </div>
                    {cohort.description && (
                        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                        {cohort.description}
                        </p>
                    )}
                    {cohort.city && (
                        <p className="mt-1 font-mono-tag text-xs text-[var(--color-ink-faint)]">
                        {cohort.city}
                        </p>
                    )}
                    </div>
                    {/* invite_only cohorts don't accept organic applications --
                        apply_to_cohort would reject with cohort_is_invite_only
                        anyway, so don't render a button implying it'll work. */}
                    {cohort.admission_mode === "apply" && (
                    <ApplyButton
                        cohortId={cohort.id}
                        alreadyPending={pendingCohortIds.has(cohort.id)}
                    />
                    )}
                </Card>
                ))}
            </div>
            )}
        </main>
        </div>
    </RequireAuth>
  );
}