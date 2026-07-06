"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Textarea } from "@/components/ui";

const RPC_ERROR_COPY: Record<string, string> = {
  cohort_not_found: "This cohort no longer exists.",
  cohort_is_invite_only:
    "This cohort only accepts new members via an invite link — ask a member for one.",
  ref_required_for_private_cohort:
    "This is a private cohort. You'll need an invite link from a current member to apply.",
  invalid_ref:
    "That invite link's referrer is no longer an active member, so it can't be used to apply here.",
  already_a_member: "You're already a member of this cohort.",
};

function friendlyRpcError(message: string): string {
  return RPC_ERROR_COPY[message] ?? message;
}

export default function ApplyButton({
  cohortId,
  alreadyPending,
  invitedBy = null,
}: {
  cohortId: string;
  alreadyPending: boolean;
  /**
   * Populated when arriving via a redeemed invite link's `ref` (see
   * app/join/page.tsx). Passed through to apply_to_cohort's p_ref so the
   * RPC can validate it and the resulting Application records invited_by.
   */
  invitedBy?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (alreadyPending || submitted) {
    return (
      <span className="font-mono-tag text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
        Application pending
      </span>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Apply
      </Button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setSubmitting(true);
    setError(null);

    // apply_to_cohort validates admission_mode/visibility/ref server-side
    // (in Postgres, since there's no app server) and raises a typed
    // exception on failure -- do not reimplement that validation here.
    const { error } = await supabase.rpc("apply_to_cohort", {
      p_cohort_id: cohortId,
      p_connection_note: note.trim(),
      p_ref: invitedBy,
    });

    setSubmitting(false);
    if (error) {
      setError(friendlyRpcError(error.message));
      return;
    }
    setSubmitted(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-64 flex-col gap-2">
      <Textarea
        autoFocus
        required
        rows={2}
        placeholder="How do you know this group?"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={280}
      />
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting} className="flex-1">
          {submitting ? "Sending…" : "Send application"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}