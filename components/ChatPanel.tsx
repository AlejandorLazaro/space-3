"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Textarea, Card } from "@/components/ui";
import type { Message } from "@/lib/types";
import { fetchCohortGroupChatId } from "@/lib/calendar/chats";

interface ChatPanelProps {
  currentUserId: string;
  /**
   * Resolves internally to that cohort's always-on L1 group chat. This is
   * the existing call site's usage (app/groups/detail/page.tsx) — unchanged
   * from before 016_chat_levels.sql.
   */
  cohortId?: string;
  /**
   * Use this exact chat directly instead of resolving one from cohortId —
   * for a specific event's coordination chat, whose id is already known
   * (fetched alongside the event itself). Takes priority if both are given.
   */
  chatId?: string;
  /** Disables the send box — e.g. an event chat whose event has ended. */
  readOnly?: boolean;
  /** Shown in place of the send box when readOnly. */
  closedNotice?: string;
  /** Header label — defaults to "Group chat" for the cohort-wide case. */
  title?: string;
}

export default function ChatPanel({
  currentUserId,
  cohortId,
  chatId: chatIdProp,
  readOnly = false,
  closedNotice,
  title = "Group chat",
}: ChatPanelProps) {
  const supabase = createClient();
  const [resolvedChatId, setResolvedChatId] = useState<string | null>(chatIdProp ?? null);
  const [resolvingChat, setResolvingChat] = useState(!chatIdProp);
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const profileCache = useRef<Map<string, string>>(new Map());

  // Resolve chatId from cohortId if a direct chatId wasn't given.
  useEffect(() => {
    if (chatIdProp) {
      setResolvedChatId(chatIdProp);
      setResolvingChat(false);
      return;
    }
    if (!cohortId) {
      setResolvingChat(false);
      return;
    }
    let cancelled = false;
    setResolvingChat(true);
    fetchCohortGroupChatId(cohortId)
      .then((id) => {
        if (!cancelled) setResolvedChatId(id);
      })
      .catch((err) => {
        console.error("Failed to resolve cohort's group chat:", err);
        if (!cancelled) setError("Couldn't load chat.");
      })
      .finally(() => {
        if (!cancelled) setResolvingChat(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cohortId, chatIdProp]);

  async function resolveDisplayName(userId: string) {
    if (profileCache.current.has(userId)) return profileCache.current.get(userId)!;
    const { data } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();
    const name = data?.display_name ?? "Member";
    profileCache.current.set(userId, name);
    return name;
  }

  useEffect(() => {
    if (!resolvedChatId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("messages")
        .select("*, profiles(display_name)")
        .eq("chat_id", resolvedChatId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (!cancelled) {
        setMessages((data ?? []) as unknown as Message[]);
        setLoading(false);
      }
    }
    load();

    const channel = supabase
      .channel(`messages:${resolvedChatId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chat_id=eq.${resolvedChatId}`,
        },
        async (payload) => {
          const row = payload.new as Message;
          const displayName = await resolveDisplayName(row.author_id);
          setMessages((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [...prev, { ...row, profiles: { display_name: displayName } }]
          );
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedChatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!resolvedChatId) return;
    const text = content.trim();
    if (!text) return;
    setSending(true);
    setContent("");
    const { error: sendError } = await supabase
      .from("messages")
      .insert({ chat_id: resolvedChatId, author_id: currentUserId, content: text });
    setSending(false);
    if (sendError) {
      console.error("Failed to send message:", {
        message: sendError.message,
        details: sendError.details,
        hint: sendError.hint,
        code: sendError.code,
      });
      setContent(text); // restore on failure so nothing is lost
    }
  }

  return (
    <Card className="flex h-[520px] flex-col">
      <div className="border-b border-[var(--color-line)] px-4 py-2.5">
        <span className="font-mono-tag text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
          {title}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {error ? (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        ) : resolvingChat || loading ? (
          <p className="text-sm text-[var(--color-ink-faint)]">Loading messages…</p>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm text-[var(--color-ink-soft)]">
              No messages yet. Say something — someone has to go first.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => {
              const mine = m.author_id === currentUserId;
              return (
                <div key={m.id} className={mine ? "text-right" : "text-left"}>
                  <div
                    className={
                      "inline-block max-w-[80%] rounded-lg px-3 py-1.5 text-sm " +
                      (mine
                        ? "bg-[var(--color-ink)] text-[var(--color-paper)]"
                        : "bg-[var(--color-fog)] text-[var(--color-ink)]")
                    }
                  >
                    {!mine && (
                      <div className="font-mono-tag mb-0.5 text-[10px] uppercase tracking-wide opacity-60">
                        {m.profiles?.display_name ?? "Member"}
                      </div>
                    )}
                    <div>{m.content}</div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {readOnly ? (
        <div className="border-t border-[var(--color-line)] p-3 text-center text-sm text-[var(--color-ink-faint)]">
          {closedNotice ?? "This chat is closed."}
        </div>
      ) : (
        <form onSubmit={handleSend} className="flex items-end gap-2 border-t border-[var(--color-line)] p-3">
          <Textarea
            rows={1}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write something…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />
          <Button type="submit" disabled={sending || !content.trim() || !resolvedChatId}>
            Send
          </Button>
        </form>
      )}
    </Card>
  );
}