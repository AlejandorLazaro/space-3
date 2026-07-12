import { createClient } from "@/lib/supabase/client";

export type RsvpStatus = "going" | "maybe" | "not_going";

/** Matches the real columns in 008_events_rsvps.sql + 014_events_color.sql. */
export interface EventRow {
  id: string;
  cohort_id: string;
  created_by: string;
  title: string;
  description: string | null;
  location: string | null;
  /** ISO timestamptz string, or null for a TBD-date event. */
  starts_at: string | null;
  ends_at: string | null;
  color: string | null;
  created_at: string;
}

export interface EventWithCohort extends EventRow {
  cohorts: { name: string } | null;
  // Reverse FK (chats.event_id -> events.id) — Supabase/PostgREST may return
  // this as an array even though 016's partial unique index guarantees at
  // most one row; extractChatId() below handles both shapes defensively.
  chats: { id: string } | { id: string }[] | null;
}

export function extractChatId(chats: EventWithCohort["chats"]): string | null {
  if (!chats) return null;
  if (Array.isArray(chats)) return chats[0]?.id ?? null;
  return chats.id ?? null;
}

export interface RsvpRow {
  event_id: string;
  user_id: string;
  status: RsvpStatus;
  updated_at: string;
}

/**
 * Fetches events for the calendar view.
 *
 * RLS (`is_active_member(cohort_id)` on `events`, see 008_events_rsvps.sql)
 * already restricts results to cohorts the current user is an active member
 * of — no client-side membership filtering needed here, same principle as
 * everywhere else in this app (RLS is the authorization boundary).
 *
 * Passing `cohortId` narrows further to a single cohort's calendar (still
 * bounded by the same RLS underneath — this is a UI-level narrowing, not a
 * security boundary).
 *
 * TBD events (starts_at IS NULL) are excluded, mirroring the same exclusion
 * already applied in the calendar-feed Edge Function — there's no sane
 * calendar-grid position for a dateless event.
 */
export async function fetchCalendarEvents(cohortId?: string): Promise<EventWithCohort[]> {
  const supabase = createClient();
  let query = supabase
    .from("events")
    .select("*, cohorts(name), chats(id)")
    .not("starts_at", "is", null)
    .order("starts_at", { ascending: true });

  if (cohortId) {
    query = query.eq("cohort_id", cohortId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as EventWithCohort[];
}

/**
 * Persists a drag/resize reschedule or a full edit-modal save. Requires
 * 012_events_update_policy.sql — without it, this resolves with no error
 * but zero rows change (RLS silent denial), because 008 never defined an
 * UPDATE policy on `events`.
 */
export async function updateEvent(
  eventId: string,
  fields: Partial<{
    title: string;
    description: string | null;
    location: string | null;
    starts_at: string;
    ends_at: string;
    color: string | null;
  }>
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("events").update(fields).eq("id", eventId);
  if (error) throw error;
}

/**
 * Requires 015_events_delete_policy.sql — without it, this resolves with no
 * error but zero rows deleted (RLS silent denial), same failure shape as the
 * missing UPDATE policy.
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("events").delete().eq("id", eventId);
  if (error) throw error;
}

export interface NewEventInput {
  cohort_id: string;
  created_by: string;
  title: string;
  description?: string | null;
  location?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  color?: string | null;
}

/**
 * Persists an event created via the calendar UI's built-in creation form.
 * `cohort_id` is required (NOT NULL, FK to cohorts) — callers must not call
 * this without a concrete cohort to attach the event to. On success, returns
 * the real DB row (including the server-generated `id`), since the caller
 * needs to replace whatever temporary id the calendar UI assigned locally.
 */
export async function insertEvent(input: NewEventInput): Promise<EventWithCohort> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("events")
    .insert(input)
    .select("*, cohorts(name)")
    .single();
  if (error) throw error;
  return data as EventWithCohort;
}

export interface UpcomingEventSummary {
  id: string;
  title: string;
  starts_at: string;
  going_count: number;
  maybe_count: number;
  not_going_count: number;
}

interface RawUpcomingEventRow {
  id: string;
  title: string;
  starts_at: string;
  rsvps: { status: RsvpStatus }[] | { status: RsvpStatus } | null;
}

/**
 * For the cohort detail page's sidebar widget. RLS on both `events` and
 * `rsvps` already scopes results to the viewer's own cohorts — no
 * client-side membership filtering needed. Counts are aggregated client-side
 * from the nested rsvps select rather than a separate count query per event,
 * since the event list here is always small (limit-bounded).
 */
export async function fetchUpcomingEventsWithRsvpCounts(
  cohortId: string,
  limit = 5
): Promise<UpcomingEventSummary[]> {
  const supabase = createClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("events")
    .select("id, title, starts_at, rsvps(status)")
    .eq("cohort_id", cohortId)
    .not("starts_at", "is", null)
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as RawUpcomingEventRow[]).map((row) => {
    const rsvpRows = Array.isArray(row.rsvps) ? row.rsvps : row.rsvps ? [row.rsvps] : [];
    const counts = { going_count: 0, maybe_count: 0, not_going_count: 0 };
    for (const r of rsvpRows) {
      if (r.status === "going") counts.going_count++;
      else if (r.status === "maybe") counts.maybe_count++;
      else if (r.status === "not_going") counts.not_going_count++;
    }
    return { id: row.id, title: row.title, starts_at: row.starts_at, ...counts };
  });
}