"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createInviteWithGeneratedCode } from "@/lib/inviteCodes";
import { requiresOriginationWarning } from "@/lib/originationWarning";
import type { Cohort, CohortInvite } from "@/lib/types";
import TopBar from "@/components/TopBar";
import { Card, Button, Input, Label, Tag } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import RequireAuth from "@/components/RequireAuth";

// NOTE: next.config.js sets a conditional `basePath` (e.g. "/space-3") in
// production. Client Components can't read that non-public build config
// directly, so a NEXT_PUBLIC_BASE_PATH env var (mirroring it) needs to be
// added alongside NEXT_PUBLIC_SUPABASE_URL for the copy-to-clipboard link
// below to be correct off-site. Falls back to "" (matches local dev) if unset.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type InviteRow = CohortInvite & { creator_name: string };

function buildJoinUrl(code: string): string {
  return `${window.location.origin}${BASE_PATH}/join?code=${code}`;
}

function InvitesPageInner() {
  const searchParams = useSearchParams();
  const cohortId = searchParams.get("id");

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [maxUses, setMaxUses] = useState<string>("");
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<InviteRow | null>(null);
  const [revokeDialog, setRevokeDialog] = useState<{
    open: boolean;
    creatorActive: boolean;
    creatorName: string | null;
  }>({ open: false, creatorActive: true, creatorName: null });

  const loadInvites = useCallback(async () => {
    if (!cohortId) return;
    const supabase = createClient();

    const { data: inviteRows, error } = await supabase
      .from("cohort_invites")
      .select("*")
      .eq("cohort_id", cohortId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load invites:", error);
      return;
    }

    const creatorIds = Array.from(new Set((inviteRows ?? []).map((i) => i.created_by)));
    const { data: profiles } = creatorIds.length
      ? await supabase.from("profiles").select("id, display_name").in("id", creatorIds)
      : { data: [] as { id: string; display_name: string }[] };

    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

    setInvites(
      (inviteRows ?? []).map((i) => ({
        ...(i as CohortInvite),
        creator_name: nameById.get(i.created_by) ?? "Member",
      }))
    );
  }, [cohortId]);

  useEffect(() => {
    if (!cohortId) {
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
        .eq("id", cohortId)
        .single();
      setCohort((cohortData as Cohort) ?? null);

      const { data: membership } = await supabase
        .from("cohort_memberships")
        .select("*")
        .eq("cohort_id", cohortId)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();
      setIsMember(!!membership);

      if (membership) {
        await loadInvites();
      }
      setLoading(false);
    })();
  }, [cohortId, loadInvites]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!cohortId || !userId) return;
    setCreating(true);

    const days = parseInt(expiresInDays, 10);
    const uses = parseInt(maxUses, 10);
    const expiresAt =
      Number.isFinite(days) && days > 0
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        : null;

    try {
      await createInviteWithGeneratedCode(cohortId, userId, {
        expiresAt,
        maxUses: Number.isFinite(uses) && uses > 0 ? uses : null,
      });
      setMaxUses("");
      setExpiresInDays("");
      await loadInvites();
    } catch (err) {
      console.error("Failed to create invite:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(invite: InviteRow) {
    await navigator.clipboard.writeText(buildJoinUrl(invite.code));
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  async function handleRevokeClick(invite: InviteRow) {
    if (!userId || !cohort) return;
    const { warn, creatorActive } = await requiresOriginationWarning(
      userId,
      { created_by: invite.created_by },
      cohort.id
    );

    if (!warn) {
      await revokeInvite(invite);
      return;
    }

    setPendingRevoke(invite);
    setRevokeDialog({
      open: true,
      creatorActive,
      creatorName: creatorActive ? invite.creator_name : null,
    });
  }

  async function revokeInvite(invite: InviteRow) {
    const supabase = createClient();
    const { error } = await supabase
      .from("cohort_invites")
      .update({ revoked: true })
      .eq("id", invite.id);
    if (error) {
      console.error("Failed to revoke invite:", error);
      return;
    }
    await loadInvites();
  }

  function closeRevokeDialog() {
    setPendingRevoke(null);
    setRevokeDialog({ open: false, creatorActive: true, creatorName: null });
  }

  if (loading) return null;

  if (!cohortId || !cohort) {
    return (
      <div className="min-h-screen bg-[var(--color-fog)]">
        <TopBar />
        <main className="mx-auto max-w-3xl px-5 py-8">
          <Card className="p-8 text-center">
            <p className="text-[var(--color-ink-soft)]">Cohort not found.</p>
          </Card>
        </main>
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="min-h-screen bg-[var(--color-fog)]">
        <TopBar />
        <main className="mx-auto max-w-3xl px-5 py-8">
          <Card className="p-8 text-center">
            <p className="text-[var(--color-ink-soft)]">
              Only active members of this cohort can manage its invite links.
            </p>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-fog)]">
      <TopBar />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <Link
          href={`/groups/detail?id=${cohort.id}`}
          className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
        >
          ← {cohort.name}
        </Link>

        <h1 className="font-display mt-3 mb-6 text-2xl">Invite links</h1>

        <form onSubmit={handleCreate} className="mb-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label>Expires in (days, optional)</Label>
            <Input
              type="number"
              min={1}
              placeholder="No expiry"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
          </div>
          <div>
            <Label>Max uses (optional)</Label>
            <Input
              type="number"
              min={1}
              placeholder="Unlimited"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={creating} className="w-full">
              {creating ? "Creating…" : "Create invite"}
            </Button>
          </div>
        </form>

        {invites.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-[var(--color-ink-soft)]">No invite links yet.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-[var(--color-line)]">
            {invites.map((invite) => {
              const isExpired = invite.expires_at
                ? new Date(invite.expires_at) < new Date()
                : false;
              const isMaxedOut =
                invite.max_uses !== null && invite.use_count >= invite.max_uses;
              const isDead = invite.revoked || isExpired || isMaxedOut;

              return (
                <div key={invite.id} className="flex items-center justify-between gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-tag text-sm">{invite.code}</span>
                      {invite.revoked && <Tag tone="amber">revoked</Tag>}
                      {!invite.revoked && isExpired && <Tag tone="amber">expired</Tag>}
                      {!invite.revoked && !isExpired && isMaxedOut && (
                        <Tag tone="amber">max uses reached</Tag>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--color-ink-faint)]">
                      Created by {invite.creator_name}
                      {invite.max_uses !== null && ` · ${invite.use_count}/${invite.max_uses} used`}
                      {invite.expires_at &&
                        ` · expires ${new Date(invite.expires_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!isDead && (
                      <Button variant="secondary" onClick={() => handleCopy(invite)}>
                        {copiedId === invite.id ? "Copied" : "Copy link"}
                      </Button>
                    )}
                    {!invite.revoked && (
                      <Button variant="ghost" onClick={() => handleRevokeClick(invite)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </main>

      <ConfirmDialog
        open={revokeDialog.open}
        title="Revoke this invite link?"
        body={
          revokeDialog.creatorActive && revokeDialog.creatorName
            ? `This link was created by ${revokeDialog.creatorName}. Revoking it means it can no longer be used to join — they won't be notified automatically.`
            : "This link's original creator is no longer an active member. Revoking it means it can no longer be used to join."
        }
        confirmLabel="Revoke"
        cancelLabel="Cancel"
        onCancel={closeRevokeDialog}
        onConfirm={() => {
          if (pendingRevoke) revokeInvite(pendingRevoke);
          closeRevokeDialog();
        }}
      />
    </div>
  );
}

export default function InvitesPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div>Loading…</div>}>
        <InvitesPageInner />
      </Suspense>
    </RequireAuth>
  );
}