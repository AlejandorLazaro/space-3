"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";

export default function SignOutButton() {
  const router = useRouter();
  const supabase = createClient();

  return (
    <Button
      variant="ghost"
      className="px-2 py-1 text-xs"
      onClick={async () => {
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}