"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createInviteWithGeneratedCode } from "@/lib/inviteCodes";
import { requiresOriginationWarning } from "@/lib/originationWarning";
import { BASE_PATH } from "@/lib/basePath";
import type { Cohort, CohortInvite } from "@/lib/types";
import { Card, Button, Input, Label, Tag } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type InviteRow = CohortInvite & { creator_name: string };

function buildJoinUrl(code: string): string {
  return `${window.location.origin}${BASE_PATH}/join?code=${code}`;
}

export default function InvitesPanel({ cohort, userId }: { cohort: Cohort; userId: string }) {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [maxUses, setMaxUses] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<InviteRow | null>(null);
  const [revokeDialog, setRevokeDialog] = useState<{
    open: boolean;
    creatorActive: boolean;
    creatorName: string | null;
  }>({ open: false, creatorActive: true, creatorName: null });

  const loadInvites = useCallback(async () => {
    const supabase = createClient();
    const { data: inviteRows, error } = await supabase
      .from("cohort_invites")
      .select("*")
      .eq("cohort_id", cohort.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load invites:", error);
      setLoading(false);
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
    setLoading(false);
  }, [cohort.id]);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);

    const days = parseInt(expiresInDays, 10);
    const uses = parseInt(maxUses, 10);
    const expiresAt =
      Number.isFinite(days) && days > 0
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        : null;

    try {
      await createInviteWithGeneratedCode(cohort.id, userId, {
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

  return (
    <div>
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
            const isMaxedOut = invite.max_uses !== null && invite.use_count >= invite.max_uses;
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