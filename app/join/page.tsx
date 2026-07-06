"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TopBar from "@/components/TopBar";
import { Card, Button, Input, Label } from "@/components/ui";
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

type Status = "needs_code" | "loading" | "error" | "joined" | "route_to_apply";

function JoinPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [cohortName, setCohortName] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!code) {
      // No code in the URL -- show the entry form instead of a dead-end
      // error. This is the actual landing state for "Have an invite code?"
      // (app/groups/page.tsx), which links here with no query param at all.
      setStatus("needs_code");
      return;
    }

    const supabase = createClient();

    (async () => {
      setStatus("loading");
      setError(null);

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
        setTimeout(() => {
          router.replace(`/groups/detail?id=${result.cohort_id}`);
        }, 1200);
        return;
      }

      setStatus("route_to_apply");
      router.replace(`/groups/detail?id=${result.cohort_id}&ref=${result.ref}`);
    })();
  }, [code, router]);

  function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = codeInput.trim().toUpperCase();
    if (!trimmed) return;
    setChecking(true);
    // Pushing ?code= re-triggers the effect above with the new searchParams
    // value -- no need to duplicate the redeem_invite call here.
    router.push(`/join?code=${trimmed}`);
  }

  return (
    <div className="min-h-screen bg-[var(--color-fog)]">
      <TopBar />
      <main className="mx-auto max-w-md px-5 py-16">
        <Card className="p-8 text-center">
          {status === "needs_code" && (
            <form onSubmit={handleSubmitCode} className="text-left">
              <p className="mb-4 text-center text-[var(--color-ink-soft)]">
                Enter the invite code someone shared with you.
              </p>
              <Label>Invite code</Label>
              <Input
                autoFocus
                required
                placeholder="e.g. 7F3K9QXH"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                maxLength={8}
                className="text-center font-mono-tag tracking-widest uppercase"
              />
              <Button type="submit" disabled={checking} className="mt-4 w-full">
                {checking ? "Checking…" : "Join"}
              </Button>
            </form>
          )}
          {status === "loading" && (
            <p className="text-[var(--color-ink-soft)]">Checking your invite…</p>
          )}
          {status === "joined" && (
            <>
              <p className="font-display text-lg">
                You&rsquo;re in{cohortName ? `, ${cohortName}` : ""}!
              </p>
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
                onClick={() => {
                  setCodeInput("");
                  setChecking(false);
                  router.replace("/join");
                }}
              >
                Try another code
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