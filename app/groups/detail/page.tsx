"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Cohort, Application } from "@/lib/types";
import TopBar from "@/components/TopBar";
import { Card, Tag, Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import ApplyButton from "@/components/ApplyButton";
import CohortChatTabs from "@/components/groups/CohortChatTabs";
import RequireAuth from "@/components/RequireAuth";
import UpcomingEventsWidget from "@/components/groups/UpcomingEventsWidget";

type Member = { user_id: string; display_name: string; role: string };

function CohortDetailPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const ref = searchParams.get("ref"); // present when arriving via a redeemed invite link (apply mode)

  const [loading, setLoading] = useState(true);
  const [notFoundState, setNotFoundState] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [myPendingApp, setMyPendingApp] = useState<Application | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingApplicationsCount, setPendingApplicationsCount] = useState(0);
  const [inviterName, setInviterName] = useState<string | null>(null);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

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
      setUserId(user.id);

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

      const memberActive = !!membership;
      setIsMember(memberActive);

      const { data: pendingApp } = await supabase
        .from("applications")
        .select("*")
        .eq("cohort_id", id)
        .eq("applicant_id", user.id)
        .eq("status", "pending")
        .maybeSingle();
      setMyPendingApp((pendingApp as Application) ?? null);

      // Show "invited by" line for non-members arriving with a ref (from a
      // redeemed apply-mode invite link). Only fetch if actually needed.
      if (!memberActive && !pendingApp && ref) {
        const { data: inviterProfile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", ref)
          .maybeSingle();
        setInviterName(inviterProfile?.display_name ?? null);
      }

      if (memberActive) {
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

        setMembers(
          (memberRows ?? []).map((m) => ({
            user_id: m.user_id,
            role: m.role,
            display_name: nameById.get(m.user_id) ?? "Member",
          }))
        );

        const { count, error: countError } = await supabase
          .from("applications")
          .select("*", { count: "exact", head: true })
          .eq("cohort_id", id)
          .eq("status", "pending");

        if (countError) console.error("Failed to load application count:", countError);

        setPendingApplicationsCount(count ?? 0);
      }

      setLoading(false);
    })();
  }, [id, ref]);

  async function handleLeave() {
    if (!cohort || !userId) return;
    setLeaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("cohort_memberships")
      .delete()
      .eq("cohort_id", cohort.id)
      .eq("user_id", userId);
    setLeaving(false);
    setLeaveDialogOpen(false);
    if (error) {
      console.error("Failed to leave cohort:", error);
      return;
    }
    router.push("/groups");
  }

  if (loading) return null; // or a skeleton

  if (notFoundState || !cohort) {
    return (
      <div className="min-h-screen bg-[var(--color-fog)]">
        <TopBar />
        <main className="mx-auto max-w-3xl px-5 py-8">
          <Card className="p-8 text-center">
            <p className="text-[var(--color-ink-soft)]">Cohort not found.</p>
            <Link href="/groups" className="mt-3 inline-block text-sm underline">
              ← All cohorts
            </Link>
          </Card>
        </main>
      </div>
    );
  }

  if (!userId) return null; // not signed in; adjust to your auth-guard pattern

  return (
    <RequireAuth>
        <div className="min-h-screen bg-[var(--color-fog)]">
        <TopBar />
        <main className="mx-auto max-w-3xl px-5 py-8">
            <Link href="/groups" className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
            ← All cohorts
            </Link>

            <div className="mt-3 mb-6 flex items-start justify-between">
            <div>
                <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl">{cohort.name}</h1>
                <Tag>{cohort.context_type}</Tag>
                {cohort.visibility === "private" && <Tag tone="amber">private</Tag>}
                </div>
                {cohort.description && (
                <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{cohort.description}</p>
                )}
                {cohort.city && (
                <p className="mt-1 font-mono-tag text-xs text-[var(--color-ink-faint)]">
                    {cohort.city}
                </p>
                )}
            </div>
            {!isMember && (
                <div className="flex flex-col items-end gap-1.5">
                {inviterName && !myPendingApp && (
                    <p className="text-xs text-[var(--color-ink-faint)]">
                    Invited by {inviterName}
                    </p>
                )}
                <ApplyButton
                    cohortId={cohort.id}
                    alreadyPending={!!myPendingApp}
                    invitedBy={ref}
                />
                </div>
            )}
            </div>

            {!isMember ? (
            <Card className="p-8 text-center">
                <p className="text-[var(--color-ink-soft)]">
                {myPendingApp
                    ? "Your application is in — a member will review it soon."
                    : cohort.admission_mode === "invite_only"
                    ? "This cohort only accepts new members via an invite link."
                    : cohort.visibility === "private" && !ref
                    ? "This is a private cohort. You'll need an invite link from a current member to apply."
                    : "Apply to join this cohort to see its members and chat."}
                </p>
            </Card>
            ) : (
            <div className="grid gap-6 sm:grid-cols-[1fr_240px]">
                <CohortChatTabs cohortId={cohort.id} currentUserId={userId} />

                <div className="flex flex-col gap-6">
                {/* Applications, Invites, and Settings all live at
                    /groups/manage now (see D6/D7) -- one entry point instead
                    of a growing list of sidebar links. */}
                <Link
                    href={`/calendar?cohortId=${cohort.id}`}
                    className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm hover:border-[var(--color-ink-faint)]"
                >
                    <span>📅 Calendar</span>
                </Link>

                <UpcomingEventsWidget cohortId={cohort.id} />

                <Link
                    href={`/groups/manage?id=${cohort.id}`}
                    className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm hover:border-[var(--color-ink-faint)]"
                >
                    <span>⚙ Manage cohort</span>
                    {pendingApplicationsCount > 0 && (
                    <span className="font-mono-tag text-xs text-[var(--color-ink-soft)]">
                        {pendingApplicationsCount} pending
                    </span>
                    )}
                </Link>

                <div>
                    <h2 className="font-mono-tag mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                    Members ({members.length})
                    </h2>
                    <Card className="divide-y divide-[var(--color-line)]">
                    {members.map((m) => (
                        <div key={m.user_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span>{m.display_name}</span>
                        {m.role === "admin" && <Tag tone="amber">admin</Tag>}
                        </div>
                    ))}
                    </Card>
                </div>

                <Button variant="danger" onClick={() => setLeaveDialogOpen(true)}>
                    Leave cohort
                </Button>
                </div>
            </div>
            )}
        </main>

        <ConfirmDialog
            open={leaveDialogOpen}
            title="Leave this cohort?"
            body="You'll lose access to its chat, events, and member list. You can rejoin later by applying again or using an invite link, if the cohort still admits new members that way."
            confirmLabel={leaving ? "Leaving…" : "Leave"}
            cancelLabel="Cancel"
            onCancel={() => setLeaveDialogOpen(false)}
            onConfirm={handleLeave}
        />
        </div>
    </RequireAuth>
  );
}

export default function CohortDetailPage() {
    return (
        <Suspense fallback={<div>Loading…</div>}>
            <CohortDetailPageInner />
        </Suspense>
    );
}