import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import { Card, Tag } from "@/components/ui";
import ApplyButton from "@/components/ApplyButton";
import ChatPanel from "@/components/ChatPanel";
import type { Cohort } from "@/lib/types";

export default async function CohortDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: cohort } = await supabase
    .from("cohorts")
    .select("*")
    .eq("id", id)
    .single();

  if (!cohort) notFound();

  const { data: membership } = await supabase
    .from("cohort_memberships")
    .select("*")
    .eq("cohort_id", id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const isMember = !!membership;

  const { data: myPendingApp } = await supabase
    .from("applications")
    .select("*")
    .eq("cohort_id", id)
    .eq("applicant_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  // Only fetch members/applications/messages if the viewer is an active member —
  // RLS would block these anyway, but skip the round-trip for non-members.
  let members: { user_id: string; display_name: string; role: string }[] = [];
  let pendingApplications: Application[] = [];
  let pendingApplicationsCount = 0;

  if (isMember) {
    const { data: memberRows, error: membersError } = await supabase
        .from("cohort_memberships")
        .select("user_id, role")
        .eq("cohort_id", id)
        .eq("status", "active");

    if (membersError) console.error("Failed to load members:", membersError);

    const memberUserIds = (memberRows ?? []).map((m) => m.user_id);

    const { data: memberProfiles, error: profilesError } = memberUserIds.length
        ? await supabase.from("profiles").select("id, display_name").in("id", memberUserIds)
        : { data: [], error: null };

    if (profilesError) console.error("Failed to load member profiles:", profilesError);

    const nameById = new Map((memberProfiles ?? []).map((p) => [p.id, p.display_name]));

    members = (memberRows ?? []).map((m) => ({
        user_id: m.user_id,
        role: m.role,
        display_name: nameById.get(m.user_id) ?? "Member",
    }));

    const { count, error: countError } = await supabase
        .from("applications")
        .select("*", { count: "exact", head: true })
        .eq("cohort_id", id)
        .eq("status", "pending");

    if (countError) console.error("Failed to load application count:", countError);

    pendingApplicationsCount = count ?? 0;
    }

  return (
    <div className="min-h-screen bg-[var(--color-fog)]">
      <TopBar />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <Link href="/groups" className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
          ← All cohorts
        </Link>

        <div className="mt-3 mb-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl">{(cohort as Cohort).name}</h1>
              <Tag>{(cohort as Cohort).context_type}</Tag>
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
          {!isMember && (
            <ApplyButton cohortId={id} alreadyPending={!!myPendingApp} />
          )}
        </div>

        {!isMember ? (
          <Card className="p-8 text-center">
            <p className="text-[var(--color-ink-soft)]">
              {myPendingApp
                ? "Your application is in — a member will review it soon."
                : "Apply to join this cohort to see its members and chat."}
            </p>
          </Card>
        ) : (
          <div className="grid gap-6 sm:grid-cols-[1fr_240px]">
            <ChatPanel cohortId={id} currentUserId={user.id} />

            <div className="flex flex-col gap-6">
              <Link
                href={`/groups/${id}/applications`}
                className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm hover:border-[var(--color-ink-faint)]"
                >
                <span>Applications</span>
                <span className="font-mono-tag text-xs text-[var(--color-ink-soft)]">
                    {pendingApplicationsCount}
                </span>
            </Link>
              <div>
                <h2 className="font-mono-tag mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                  Members ({members.length})
                </h2>
                <Card className="divide-y divide-[var(--color-line)]">
                  {members.map((m) => (
                    <div key={m.user_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="presence-dot" aria-hidden />
                      <span>{m.display_name}</span>
                      {m.role === "admin" && <Tag tone="amber">admin</Tag>}
                    </div>
                  ))}
                </Card>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
