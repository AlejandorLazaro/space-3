"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Button } from "@/components/ui";
import type { Application } from "@/lib/types";

const RPC_ERROR_COPY: Record<string, string> = {
  application_not_found: "This application no longer exists.",
  application_not_pending: "This application has already been reviewed.",
  not_authorized: "You're no longer an active member of this cohort.",
};

function friendlyRpcError(message: string): string {
  return RPC_ERROR_COPY[message] ?? "Something went wrong reviewing this application.";
}

export default function ApplicationQueue({
  applications,
  onReviewed,
}: {
  applications: Application[];
  /**
   * Called after a successful approve/decline so the parent can refetch the
   * pending list. Replaces the previous router.refresh() call, which in this
   * static-export, fully client-rendered app doesn't do the Server Component
   * revalidation it implies elsewhere in Next -- it was likely a no-op here.
   */
  onReviewed: () => void;
}) {
  const supabase = createClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve(applicationId: string) {
    setPendingId(applicationId);
    setError(null);

    // approve_application is a SECURITY DEFINER RPC that updates the
    // application AND inserts the resulting cohort_membership row in one
    // transaction (see 004_approve_application_rpc.sql) -- do not
    // reintroduce a direct client-side status update here, that's the exact
    // bug this migration fixed (approved applications with no membership).
    const { error } = await supabase.rpc("approve_application", {
      p_application_id: applicationId,
    });

    setPendingId(null);
    if (error) {
      setError(friendlyRpcError(error.message));
      return;
    }
    onReviewed();
  }

  async function decline(applicationId: string) {
    setPendingId(applicationId);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("applications")
      .update({ status: "declined", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq("id", applicationId);

    setPendingId(null);
    if (error) {
      setError("Something went wrong declining this application.");
      return;
    }
    onReviewed();
  }

  return (
    <Card className="divide-y divide-[var(--color-line)]">
      {error && <p className="p-3 text-xs text-[var(--color-danger)]">{error}</p>}
      {applications.map((app) => (
        <div key={app.id} className="p-3">
          <p className="text-sm font-medium">{app.profiles?.display_name ?? "Applicant"}</p>
          <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{app.connection_note}</p>
          <div className="mt-2 flex gap-2">
            <Button
              className="px-2.5 py-1 text-xs"
              disabled={pendingId === app.id}
              onClick={() => approve(app.id)}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              className="px-2.5 py-1 text-xs"
              disabled={pendingId === app.id}
              onClick={() => decline(app.id)}
            >
              Decline
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}