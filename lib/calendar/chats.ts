import dayjs from "dayjs";
import { createClient } from "@/lib/supabase/client";

export type ChatLevel = "group" | "planning" | "idea";

export interface ChatRow {
  id: string;
  cohort_id: string;
  level: ChatLevel;
  title: string | null;
  event_id: string | null;
  created_by: string | null;
  created_at: string;
  spun_off: boolean;
}

/** Resolves a cohort's always-on L1 group chat id — every cohort has exactly one (backfilled by 016_chat_levels.sql). */
export async function fetchCohortGroupChatId(cohortId: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("chats")
    .select("id")
    .eq("cohort_id", cohortId)
    .eq("level", "group")
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export interface NewEventChatInput {
  cohort_id: string;
  event_id: string;
  title: string;
  created_by: string;
}

/**
 * Creates the coordination chat for a newly-created event. Called as a
 * second insert right after insertEvent() succeeds — not wrapped in a
 * single atomic RPC in this pass, since both writes are the same user's own
 * two inserts in immediate succession (low real risk of a crash between
 * them for a PoC). If this fails after the event insert already succeeded,
 * the event exists without a chat — recoverable manually, not silently
 * corrupting anything.
 */
/**
 * Shared banner copy for an event chat's ephemerality, used by both
 * CohortChatTabs.tsx and CohortCalendarPoc.tsx's modal so the two surfaces
 * never drift out of sync on wording or the underlying date math.
 */
export function describeEventChatLifecycle(endsAt: string, chatClosesAfterHours: number): string {
  const closesAt = dayjs(endsAt).add(chatClosesAfterHours, "hour");
  const deletesAt = dayjs(endsAt).add(90, "day");
  const now = dayjs();

  const closesPart = closesAt.isBefore(now)
    ? `This chat closed to new messages on ${closesAt.format("MMM D, YYYY")}.`
    : `This chat closes to new messages on ${closesAt.format("MMM D, YYYY, h:mm A")}.`;

  return `${closesPart} This event and its chat will be permanently deleted around ${deletesAt.format("MMM D, YYYY")}.`;
}

export async function createEventChat(input: NewEventChatInput): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("chats")
    .insert({ ...input, level: "idea", spun_off: true })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export interface EventChatTabInfo {
  event_id: string;
  event_title: string;
  starts_at: string;
  ends_at: string | null;
  chat_closes_after_hours: number;
  chat_id: string | null;
  closed: boolean;
}

interface RawEventChatTabRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  chat_closes_after_hours: number;
  chats: { id: string } | { id: string }[] | null;
}

function extractChatIdFromRow(chats: RawEventChatTabRow["chats"]): string | null {
  if (!chats) return null;
  if (Array.isArray(chats)) return chats[0]?.id ?? null;
  return chats.id ?? null;
}

/**
 * Events worth a chat tab in the main panel: open (not yet closed) or
 * closed within the last `windowDays` — where "closed" now factors in each
 * event's configurable chat_closes_after_hours grace period
 * (019_events_chat_grace_period.sql), not just raw ends_at. RSVP-
 * independent — RLS never gated event chat access by RSVP, and gating
 * discoverability by it would work against the app's own "see the
 * conversation before committing" design philosophy.
 *
 * The DB query below uses a coarse, generous cutoff as a pre-filter —
 * Supabase's JS client can't express "ends_at + variable-per-row grace
 * period" as a single .gte() filter, since that's a computed expression,
 * not a plain column. The precise open/recently-closed rule is applied
 * client-side per row, using its actual grace period, so a long grace
 * period can't cause a chat to roll off the tab bar while still open.
 */
export async function fetchEventChatTabs(
  cohortId: string,
  windowDays = 7
): Promise<EventChatTabInfo[]> {
  const supabase = createClient();
  const now = dayjs();
  const coarseCutoff = now.subtract(Math.max(windowDays, 30), "day").toISOString();
  const windowCutoff = now.subtract(windowDays, "day");

  const { data, error } = await supabase
    .from("events")
    .select("id, title, starts_at, ends_at, chat_closes_after_hours, chats(id)")
    .eq("cohort_id", cohortId)
    .not("starts_at", "is", null)
    .gte("ends_at", coarseCutoff)
    .order("starts_at", { ascending: true });

  if (error) throw error;

  const results: EventChatTabInfo[] = [];
  for (const row of (data ?? []) as RawEventChatTabRow[]) {
    if (!row.ends_at) continue; // guarded against by not.is.null(starts_at) + the app's own creation flow always setting ends_at, but defensive anyway
    const graceHours = row.chat_closes_after_hours ?? 0;
    const chatClosesAt = dayjs(row.ends_at).add(graceHours, "hour");
    const closed = chatClosesAt.isBefore(now);
    if (closed && chatClosesAt.isBefore(windowCutoff)) continue; // rolled off the recently-closed window

    results.push({
      event_id: row.id,
      event_title: row.title,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      chat_closes_after_hours: graceHours,
      chat_id: extractChatIdFromRow(row.chats),
      closed,
    });
  }
  return results;
}