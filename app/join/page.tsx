"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TopBar from "@/components/TopBar";
import { Card, Button } from "@/components/ui";
import RequireAuth from "@/components/RequireAuth";

const RPC_ERROR_COPY: Record<string, string> = {
  invite_not_found: "That invite code doesn't exist. Double-check it and try again.",
  invite_revoked: "This invite link has been revoked by a cohort member.",
  invite_expired: "This invite link has expired.",
  invite_max_uses_reached: "This invite link has already been used the maximum number of times.",
};

function friendlyRpcError(message: string): string {
  return RPC_ERROR_COPY[message] ?? "Something went wrong redeeming this invite.";
}

type RedeemResult = {
  mode: "invite_only" | "apply";
  cohort_id: string;
  cohort_name?: string;
  ref?: string;
  joined: boolean;
};

function JoinPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");

  const [status, setStatus] = useState<"loading" | "error" | "joined" | "route_to_apply">(
    "loading"
  );
  const [error, setError] = useState<string | null>(null);
  const [cohortName, setCohortName] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setStatus("error");
      setError("No invite code was provided.");
      return;
    }

    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return; // RequireAuth will redirect to /login

      const { data, error } = await supabase.rpc("redeem_invite", { p_code: code });

      if (error) {
        setStatus("error");
        setError(friendlyRpcError(error.message));
        return;
      }

      const result = data as RedeemResult;

      if (result.mode === "invite_only") {
        setStatus("joined");
        setCohortName(result.cohort_name ?? null);
        // Brief pause so the "You're in" state is actually visible before
        // navigating away.
        setTimeout(() => {
          router.replace(`/groups/detail?id=${result.cohort_id}`);
        }, 1200);
        return;
      }

      // mode === "apply": don't consume the invite here -- hand off to the
      // cohort detail page with `ref` pre-filled so ApplyButton can pass it
      // through to apply_to_cohort. use_count only increments on approval
      // in this mode (see redeem_invite in 002_cohort_privacy_rls.sql).
      setStatus("route_to_apply");
      router.replace(`/groups/detail?id=${result.cohort_id}&ref=${result.ref}`);
    })();
  }, [code, router]);

  return (
    <div className="min-h-screen bg-[var(--color-fog)]">
      <TopBar />
      <main className="mx-auto max-w-md px-5 py-16">
        <Card className="p-8 text-center">
          {status === "loading" && (
            <p className="text-[var(--color-ink-soft)]">Checking your invite…</p>
          )}
          {status === "joined" && (
            <>
              <p className="font-display text-lg">You&rsquo;re in{cohortName ? `, ${cohortName}` : ""}!</p>
              <p className="mt-1 text-sm text-[var(--color-ink-soft)]">Taking you there now…</p>
            </>
          )}
          {status === "route_to_apply" && (
            <p className="text-[var(--color-ink-soft)]">Taking you to the application…</p>
          )}
          {status === "error" && (
            <>
              <p className="text-[var(--color-ink-soft)]">{error}</p>
              <Button
                variant="secondary"
                className="mt-4"
                onClick={() => router.replace("/groups")}
              >
                Back to cohorts
              </Button>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}

export default function JoinPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div>Loading…</div>}>
        <JoinPageInner />
      </Suspense>
    </RequireAuth>
  );
}