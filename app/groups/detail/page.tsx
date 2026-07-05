"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Cohort, Application, CohortVisibility, CohortAdmissionMode } from "@/lib/types";
import { requiresOriginationWarning } from "@/lib/originationWarning";
import TopBar from "@/components/TopBar";
import { Card, Tag, Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import ApplyButton from "@/components/ApplyButton";
import ChatPanel from "@/components/ChatPanel";
import RequireAuth from "@/components/RequireAuth";

type Member = { user_id: string; display_name: string; role: string };

// Which setting a pending settings-toggle confirmation applies to. Kept as a
// discriminated field (not two separate dialog states) since only one
// settings change can be in flight for confirmation at a time.
type PendingSettingChange =
  | { field: "visibility"; next: CohortVisibility }
  | { field: "admission_mode"; next: CohortAdmissionMode };

function CohortDetailPageInner() {
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

  const [settingsDialog, setSettingsDialog] = useState<{
    open: boolean;
    creatorActive: boolean;
    creatorName: string | null;
  }>({ open: false, creatorActive: true, creatorName: null });
  const [pendingSettingChange, setPendingSettingChange] = useState<PendingSettingChange | null>(
    null
  );

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

  async function requestSettingChange(change: PendingSettingChange) {
    if (!userId || !cohort) return;

    const { warn, creatorActive } = await requiresOriginationWarning(
      userId,
      { created_by: cohort.created_by },
      cohort.id
    );

    if (!warn) {
      await applySettingChange(change);
      return;
    }

    let creatorName: string | null = null;
    if (creatorActive) {
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", cohort.created_by)
        .maybeSingle();
      creatorName = data?.display_name ?? null;
    }

    setPendingSettingChange(change);
    setSettingsDialog({ open: true, creatorActive, creatorName });
  }

  async function applySettingChange(change: PendingSettingChange) {
    if (!cohort) return;
    const supabase = createClient();
    const patch =
      change.field === "visibility"
        ? { visibility: change.next }
        : { admission_mode: change.next };

    const { error } = await supabase.from("cohorts").update(patch).eq("id", cohort.id);
    if (error) {
      console.error("Failed to update cohort settings:", error);
      return;
    }
    setCohort({ ...cohort, ...patch });
  }

  function closeSettingsDialog() {
    setPendingSettingChange(null);
    setSettingsDialog({ open: false, creatorActive: true, creatorName: null });
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
                <ChatPanel cohortId={cohort.id} currentUserId={userId} />

                <div className="flex flex-col gap-6">
                <Link
                    href={`/groups/applications?id=${cohort.id}`}
                    className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm hover:border-[var(--color-ink-faint)]"
                >
                    <span>Applications</span>
                    <span className="font-mono-tag text-xs text-[var(--color-ink-soft)]">
                    {pendingApplicationsCount}
                    </span>
                </Link>

                <Link
                    href={`/groups/invites?id=${cohort.id}`}
                    className="flex items-center justify-between rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm hover:border-[var(--color-ink-faint)]"
                >
                    <span>Invite links</span>
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

                <div>
                    <h2 className="font-mono-tag mb-2 text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                    Cohort settings
                    </h2>
                    <Card className="flex flex-col gap-3 p-3">
                    <div>
                        <p className="mb-1.5 text-xs text-[var(--color-ink-soft)]">Visibility</p>
                        <div className="flex gap-2">
                        <Button
                            variant={cohort.visibility === "public" ? "primary" : "secondary"}
                            className="flex-1"
                            onClick={() =>
                            requestSettingChange({ field: "visibility", next: "public" })
                            }
                        >
                            Public
                        </Button>
                        <Button
                            variant={cohort.visibility === "private" ? "primary" : "secondary"}
                            className="flex-1"
                            onClick={() =>
                            requestSettingChange({ field: "visibility", next: "private" })
                            }
                        >
                            Private
                        </Button>
                        </div>
                    </div>
                    <div>
                        <p className="mb-1.5 text-xs text-[var(--color-ink-soft)]">Admission</p>
                        <div className="flex gap-2">
                        <Button
                            variant={cohort.admission_mode === "apply" ? "primary" : "secondary"}
                            className="flex-1"
                            onClick={() =>
                            requestSettingChange({ field: "admission_mode", next: "apply" })
                            }
                        >
                            Apply
                        </Button>
                        <Button
                            variant={
                            cohort.admission_mode === "invite_only" ? "primary" : "secondary"
                            }
                            className="flex-1"
                            onClick={() =>
                            requestSettingChange({ field: "admission_mode", next: "invite_only" })
                            }
                        >
                            Invite only
                        </Button>
                        </div>
                    </div>
                    </Card>
                </div>
                </div>
            </div>
            )}
        </main>

        <ConfirmDialog
            open={settingsDialog.open}
            title="Change this cohort's settings?"
            body={
            settingsDialog.creatorActive && settingsDialog.creatorName
                ? `This cohort was set up by ${settingsDialog.creatorName}. Changing this setting affects every member — continue?`
                : "This cohort's original creator is no longer an active member. Changing this setting affects every member — continue?"
            }
            confirmLabel="Change setting"
            cancelLabel="Cancel"
            onCancel={closeSettingsDialog}
            onConfirm={() => {
            if (pendingSettingChange) applySettingChange(pendingSettingChange);
            closeSettingsDialog();
            }}
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