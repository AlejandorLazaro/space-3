"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import SignOutButton from "@/components/SignOutButton";

export default function TopBar() {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsSignedIn(false);
        return;
      }
      setIsSignedIn(true);

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();

      setDisplayName(profile?.display_name ?? null);
    })();
  }, []);

  return (
    <header className="border-b border-[var(--color-line)] bg-[var(--color-paper)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3.5">
        <Link href="/groups" className="font-display text-lg text-[var(--color-ink)]">
          Space<sup className="text-xs">3</sup>
        </Link>
        {isSignedIn && (
          <div className="flex items-center gap-3 text-sm text-[var(--color-ink-soft)]">
            <span>{displayName}</span>
            <SignOutButton />
          </div>
        )}
      </div>
    </header>
  );
}