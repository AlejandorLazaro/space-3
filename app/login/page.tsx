"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label, Card } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    let loginEmail = identifier.trim();
    if (!loginEmail.includes("@")) {
      const { data: resolvedEmail, error: lookupError } = await supabase.rpc(
        "email_for_login",
        { p_identifier: loginEmail }
      );
      if (lookupError || !resolvedEmail) {
        setLoading(false);
        setError("We couldn't find an account with that username or email.");
        return;
      }
      loginEmail = resolvedEmail as string;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/groups");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-fog)] px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl text-[var(--color-ink)]">
            Space<sup className="text-base">3</sup>
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
            A space for your neighbor and you - <i>so get out there!</i>
          </p>
        </div>
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label>Email or username</Label>
              <Input
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="spaceman@example.com"
              />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p className="text-sm text-[var(--color-danger)]">{error}</p>
            )}
            <Button type="submit" disabled={loading} className="mt-1 w-full">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-[var(--color-ink-soft)]">
          New here?{" "}
          <Link href="/signup" className="text-[var(--color-ink)] underline underline-offset-2">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
