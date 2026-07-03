import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";

export default async function TopBar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single();
    displayName = profile?.display_name ?? null;
  }

  return (
    <header className="border-b border-[var(--color-line)] bg-[var(--color-paper)]">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3.5">
        <Link href="/groups" className="font-display text-lg text-[var(--color-ink)]">
          Space<sup className="text-xs">3</sup>
        </Link>
        {user && (
          <div className="flex items-center gap-3 text-sm text-[var(--color-ink-soft)]">
            <span>{displayName}</span>
            <SignOutButton />
          </div>
        )}
      </div>
    </header>
  );
}
