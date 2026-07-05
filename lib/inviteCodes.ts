// D5: CohortInvite.code generation.
// 8 characters, unambiguous base32-style charset (no 0/O/1/I/l), generated
// via insert-and-retry-on-collision rather than a pre-check (RLS only lets a
// member read invites for cohorts they belong to, so a pre-check can't see
// the true global uniqueness constraint on `code`).
//
// Uses the Web Crypto API (global `crypto`), NOT Node's `crypto` module --
// every page in this app is a Client Component ("use client") running
// entirely in the browser with no Node runtime at request time. `crypto` is
// available globally in all modern browsers without an import.

import { createClient } from "@/lib/supabase/client";
import type { CohortInvite } from "@/lib/types";

const CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 32 chars, excludes 0/O/1/I/l
const CODE_LENGTH = 8;
const MAX_GENERATION_ATTEMPTS = 5;
const POSTGRES_UNIQUE_VIOLATION = "23505";

function generateCandidateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return code;
}

export interface NewCohortInviteOptions {
  expiresAt?: string | null;
  maxUses?: number | null;
}

/**
 * Creates a CohortInvite with a freshly generated unique code. Attempts the
 * insert directly and retries on a Postgres unique-violation rather than
 * checking existence first -- see architecture note above.
 */
export async function createInviteWithGeneratedCode(
  cohortId: string,
  actorId: string,
  options: NewCohortInviteOptions = {}
): Promise<CohortInvite> {
  const supabase = createClient();

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateCandidateCode();
    const { data, error } = await supabase
      .from("cohort_invites")
      .insert({
        cohort_id: cohortId,
        code: candidate,
        created_by: actorId,
        expires_at: options.expiresAt ?? null,
        max_uses: options.maxUses ?? null,
      })
      .select()
      .single();

    if (!error) {
      return data as CohortInvite;
    }
    if (error.code !== POSTGRES_UNIQUE_VIOLATION) {
      throw error; // RLS denial, bad cohort_id, etc. -- not a collision, don't retry
    }
  }

  throw new Error(
    `Failed to generate a unique invite code after ${MAX_GENERATION_ATTEMPTS} attempts`
  );
}