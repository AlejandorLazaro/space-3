import { createClient } from "@/lib/supabase/client";
import type { RsvpStatus } from "@/lib/calendar/events";

export interface RsvpWithProfile {
  user_id: string;
  status: RsvpStatus;
  updated_at: string;
  display_name: string | null;
}

interface RawProfileJoin {
  display_name: string | null;
}

interface RawRsvpRow {
  user_id: string;
  status: RsvpStatus;
  updated_at: string;
  // Supabase's nested-select shape for a many-to-one FK join (rsvps.user_id
  // -> profiles.id) should be a single object, not an array — but handled
  // defensively for both shapes since this hasn't been confirmed live.
  profiles: RawProfileJoin | RawProfileJoin[] | null;
}

function extractDisplayName(profiles: RawRsvpRow["profiles"]): string | null {
  if (!profiles) return null;
  if (Array.isArray(profiles)) return profiles[0]?.display_name ?? null;
  return profiles.display_name ?? null;
}

/**
 * RLS ("members can read rsvps for events in their own cohorts", 008)
 * already scopes this to events in cohorts the viewer is an active member
 * of — no client-side filtering needed. Profile visibility for the joined
 * `profiles.display_name` is covered by the co-member case in
 * 007_scope_profiles_read.sql (same cohort membership either way).
 */
export async function fetchEventRsvps(eventId: string): Promise<RsvpWithProfile[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("rsvps")
    .select("user_id, status, updated_at, profiles(display_name)")
    .eq("event_id", eventId);
  if (error) throw error;
  return ((data ?? []) as RawRsvpRow[]).map((row) => ({
    user_id: row.user_id,
    status: row.status,
    updated_at: row.updated_at,
    display_name: extractDisplayName(row.profiles),
  }));
}

/**
 * Upsert on the (event_id, user_id) primary key — covers both the first
 * RSVP (INSERT policy) and changing an existing one (UPDATE policy), both
 * already defined in 008 with the same auth.uid() = user_id check.
 */
export async function upsertRsvp(
  eventId: string,
  userId: string,
  status: RsvpStatus
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("rsvps")
    .upsert(
      { event_id: eventId, user_id: userId, status, updated_at: new Date().toISOString() },
      { onConflict: "event_id,user_id" }
    );
  if (error) throw error;
}