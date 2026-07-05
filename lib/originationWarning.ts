// Project-wide principle: mutating an artifact you didn't originate requires
// a warn/confirm step; mutating your own does not.
//
// D2: revoking a CohortInvite you didn't create warns
// D3: toggling cohort visibility/admission_mode warns if actor != cohort.created_by
// D4: if the creator is no longer an active member, warn for everyone (no exemption)
//
// IMPORTANT: this is a client-side UX gate only. RLS (see
// 002_cohort_privacy_rls.sql) deliberately permits any active member to
// revoke any invite or toggle any cohort's settings -- that's the resolved
// "unrestricted, trust-based" behavior. This function decides whether to
// show a confirmation dialog before firing the mutation; it has no
// enforcement power of its own. A user who bypasses the UI (e.g. calling
// supabase.from(...) directly from devtools) will never see this check, and
// that's an accepted tradeoff, not a gap to close here.

import { createClient } from "@/lib/supabase/client";

export interface OriginatedArtifact {
  created_by: string;
}

export interface OriginationWarningResult {
  /** Whether to show a confirm dialog before proceeding. */
  warn: boolean;
  /**
   * Whether artifact.created_by is still an active member of the cohort.
   * Lets the caller pick dialog copy: name the creator when true, fall back
   * to neutral "no longer active" framing when false (D4's branch).
   */
  creatorActive: boolean;
}

export async function requiresOriginationWarning(
  actorId: string,
  artifact: OriginatedArtifact,
  cohortId: string
): Promise<OriginationWarningResult> {
  if (actorId === artifact.created_by) {
    return { warn: false, creatorActive: true };
  }

  const supabase = createClient();
  const { data } = await supabase
    .from("cohort_memberships")
    .select("status")
    .eq("cohort_id", cohortId)
    .eq("user_id", artifact.created_by)
    .eq("status", "active")
    .maybeSingle();

  // D4: warn either way -- the branch only changes the copy, not the outcome.
  return { warn: true, creatorActive: data !== null };
}