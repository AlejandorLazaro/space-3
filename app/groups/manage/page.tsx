"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Cohort } from "@/lib/types";
import TopBar from "@/components/TopBar";
import { Card, Button } from "@/components/ui";
import RequireAuth from "@/components/RequireAuth";
import ApplicationsPanel from "@/components/manage/ApplicationsPanel";
import InvitesPanel from "@/components/manage/InvitesPanel";
import SettingsPanel from "@/components/manage/SettingsPanel";

type Tab = "applications" | "invites" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "applications", label: "Applications" },
  { key: "invites", label: "Invites" },
  { key: "settings", label: "Settings" },
];

function isTab(value: string | null): value is Tab {
  return value === "applications" || value === "invites" || value === "settings";
}

function ManagePageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const activeTab: Tab = isTab(searchParams.get("tab")) ? (searchParams.get("tab") as Tab) : "applications";

  const [loading, setLoading] = useState(true);
  const [notFoundState, setNotFoundState] = useState(false);
  const [notMember, setNotMember] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [cohort, setCohort] = useState<Cohort | null>(null);

  useEffect(() => {
    if (!id) {
      setNotFoundState(true);
      setLoading(false);
      return;
    }

    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);

      const { data: cohortData } = await supabase
        .from("cohorts")
        .select("*")
        .eq("id", id)
        .single();

      if (!cohortData) {
        setNotFoundState(true);
        setLoading(false);
        return;
      }
      setCohort(cohortData as Cohort);

      const { data: membership } = await supabase
        .from("cohort_memberships")
        .select("*")
        .eq("cohort_id", id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      if (!membership) {
        // Not a member -- nothing to manage, and RLS would block every
        // panel's queries anyway (applications/invites are member-gated;
        // settings updates require active membership too).
        setNotMember(true);
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading) return null;

  if (notFoundState || notMember || !cohort || !userId) {
    return (
      <div className="min-h-screen bg-[var(--color-fog)]">
        <TopBar />
        <main className="mx-auto max-w-2xl px-5 py-8">
          <Card className="p-8 text-center">
            <p className="text-[var(--color-ink-soft)]">
              {notMember ? "You don't have access to this page." : "Cohort not found."}
            </p>
            <Link href="/groups" className="mt-3 inline-block text-sm underline">
              ← All cohorts
            </Link>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <RequireAuth>
      <div className="min-h-screen bg-[var(--color-fog)]">
        <TopBar />
        <main className="mx-auto max-w-2xl px-5 py-8">
          <Link
            href={`/groups/detail?id=${cohort.id}`}
            className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
          >
            ← {cohort.name}
          </Link>

          <h1 className="font-display mt-3 mb-6 text-2xl">Manage cohort</h1>

          <div className="mb-6 flex gap-2 border-b border-[var(--color-line)] pb-3">
            {TABS.map((t) => (
              <Link key={t.key} href={`/groups/manage?id=${cohort.id}&tab=${t.key}`}>
                <Button variant={activeTab === t.key ? "primary" : "ghost"}>{t.label}</Button>
              </Link>
            ))}
          </div>

          {activeTab === "applications" && <ApplicationsPanel cohortId={cohort.id} />}
          {activeTab === "invites" && <InvitesPanel cohort={cohort} userId={userId} />}
          {activeTab === "settings" && (
            <SettingsPanel cohort={cohort} userId={userId} onChange={setCohort} />
          )}
        </main>
      </div>
    </RequireAuth>
  );
}

export default function ManagePage() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <ManagePageInner />
    </Suspense>
  );
}