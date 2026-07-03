"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button } from "@/components/ui";
import type { Application } from "@/lib/types";

export default function ApplicationQueue({
  applications,
}: {
  applications: Application[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function review(applicationId: string, status: "approved" | "declined") {
    setPendingId(applicationId);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("applications")
      .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq("id", applicationId);

    setPendingId(null);
    router.refresh();
  }

  return (
    <Card className="divide-y divide-[var(--color-line)]">
      {applications.map((app) => (
        <div key={app.id} className="p-3">
          <p className="text-sm font-medium">{app.profiles?.display_name ?? "Applicant"}</p>
          <p className="mt-0.5 text-sm text-[var(--color-ink-soft)]">{app.connection_note}</p>
          <div className="mt-2 flex gap-2">
            <Button
              className="px-2.5 py-1 text-xs"
              disabled={pendingId === app.id}
              onClick={() => review(app.id, "approved")}
            >
              Approve
            </Button>
            <Button
              variant="secondary"
              className="px-2.5 py-1 text-xs"
              disabled={pendingId === app.id}
              onClick={() => review(app.id, "declined")}
            >
              Decline
            </Button>
          </div>
        </div>
      ))}
    </Card>
  );
}
