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