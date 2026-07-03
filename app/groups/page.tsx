import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import { Card, Tag, Button } from "@/components/ui";
import ApplyButton from "@/components/ApplyButton";
import type { Cohort, Membership, Application } from "@/lib/types";

export default async function GroupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

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

  const allCohorts = (cohorts ?? []) as Cohort[];
  const myMemberships = (memberships ?? []) as Membership[];
  const myPendingApps = (applications ?? []) as Application[];

  const myCohortIds = new Set(myMemberships.map((m) => m.cohort_id));
  const pendingCohortIds = new Set(myPendingApps.map((a) => a.cohort_id));

  const myCohorts = allCohorts.filter((c) => myCohortIds.has(c.id));
  const discoverCohorts = allCohorts.filter((c) => !myCohortIds.has(c.id));

  return (
    <div className="min-h-screen bg-[var(--color-fog)]">
      <TopBar />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="font-display text-2xl">My cohorts</h1>
          <Link href="/groups/new">
            <Button variant="secondary">+ New cohort</Button>
          </Link>
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
              <Link key={cohort.id} href={`/groups/${cohort.id}`}>
                <Card className="flex items-center justify-between p-4 transition-colors hover:border-[var(--color-ink-faint)]">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="presence-dot" aria-hidden />
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
                <ApplyButton
                  cohortId={cohort.id}
                  alreadyPending={pendingCohortIds.has(cohort.id)}
                />
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
