import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TopBar from "@/components/TopBar";
import { Card } from "@/components/ui";
import ApplicationQueue from "@/components/ApplicationQueue";
import type { Application, Cohort } from "@/lib/types";

export default async function ApplicationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: cohort } = await supabase
    .from("cohorts")
    .select("*")
    .eq("id", id)
    .single();
  if (!cohort) notFound();

  const { data: membership } = await supabase
    .from("cohort_memberships")
    .select("*")
    .eq("cohort_id", id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) {
    // Not a member — nothing to manage, and RLS would block the query below anyway.
    notFound();
  }

  const { data: appRows, error } = await supabase
    .from("applications")
    .select("*, profiles!applicant_id(display_name)")
    .eq("cohort_id", id)
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) console.error("Failed to load applications:", error);

  const pendingApplications = (appRows ?? []) as unknown as Application[];

  return (
    <div className="min-h-screen bg-[var(--color-fog)]">
      <TopBar />
      <main className="mx-auto max-w-2xl px-5 py-8">
        <Link
          href={`/groups/${id}`}
          className="text-sm text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
        >
          ← {(cohort as Cohort).name}
        </Link>

        <h1 className="font-display mt-3 mb-6 text-2xl">
          Applications ({pendingApplications.length})
        </h1>

        {error ? (
          <Card className="p-8 text-center">
            <p className="text-[var(--color-danger)]">
              Couldn&rsquo;t load applications. Check the server logs — this
              is usually an RLS or query error, not an empty list.
            </p>
          </Card>
        ) : pendingApplications.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-[var(--color-ink-soft)]">
              No pending applications right now.
            </p>
          </Card>
        ) : (
          <ApplicationQueue applications={pendingApplications} />
        )}
      </main>
    </div>
  );
}