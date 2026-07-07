"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui";

export default function TopBar() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  return (
    <header className="border-b border-[var(--color-line)] bg-[var(--color-paper)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3.5">
        <Link href="/groups" className="font-display text-lg text-[var(--color-ink)]">
          Space<sup className="text-xs">3</sup>
        </Link>

        {isSignedIn && (
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-[var(--color-ink-soft)] hover:bg-black/5 hover:text-[var(--color-ink)]"
            >
              <span>{displayName}</span>
            </button>

            {menuOpen && (
              <Card
                role="menu"
                className="absolute right-0 top-[calc(100%+6px)] z-10 min-w-[10rem] overflow-hidden p-1 shadow-md"
              >
                <Link
                  href="/settings"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center justify-center rounded-md px-3 py-2 text-sm text-[var(--color-ink)] hover:bg-black/5"
                >
                  Settings
                </Link>
                <button
                  role="menuitem"
                  onClick={async () => {
                    setMenuOpen(false);
                    const supabase = createClient();
                    await supabase.auth.signOut();
                    router.push("/login");
                    router.refresh();
                  }}
                  className="flex w-full items-center justify-center rounded-md px-3 py-2 text-sm text-[var(--color-ink)] hover:bg-black/5"
                >
                  Sign out
                </button>
              </Card>
            )}
          </div>
        )}
      </div>
    </header>
  );
}