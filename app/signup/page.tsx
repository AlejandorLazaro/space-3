"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label, Card } from "@/components/ui";

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, username } },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // If email confirmation is enabled in the Supabase project, there's no
    // session yet — tell the user to check their inbox instead of redirecting.
    if (data.session) {
      router.push("/groups");
      router.refresh();
    } else {
      setCheckEmail(true);
    }
  }

  if (checkEmail) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-fog)] px-5">
        <Card className="max-w-sm p-6 text-center">
          <h1 className="font-display text-xl">Check your email</h1>
          <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
            We sent a confirmation link to {email}. Follow it to activate your account, then
            sign in.
          </p>
          <Link href="/login" className="mt-4 inline-block text-sm underline underline-offset-2">
            Back to sign in
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-fog)] px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl text-[var(--color-ink)]">
            Space<sup className="text-base">3</sup>
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
            Find the people already around you.
          </p>
        </div>
        <Card className="p-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label>Display name</Label>
              <Input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Spaceman"
              />
            </div>
            <div>
              <Label>Username</Label>
              <Input
                required
                pattern="[a-zA-Z0-9_]{3,20}"
                title="3-20 characters, letters/numbers/underscores only"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="spaceman"
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="rocketship@example.com"
              />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            {error && (
              <p className="text-sm text-[var(--color-danger)]">{error}</p>
            )}
            <Button type="submit" disabled={loading} className="mt-1 w-full">
              {loading ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-[var(--color-ink-soft)]">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--color-ink)] underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
