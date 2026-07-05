"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Textarea, Card } from "@/components/ui";
import type { Message } from "@/lib/types";

export default function ChatPanel({
  cohortId,
  currentUserId,
}: {
  cohortId: string;
  currentUserId: string;
}) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const profileCache = useRef<Map<string, string>>(new Map());

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
    let cancelled = false;

    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from("messages")
        .select("*, profiles(display_name)")
        .eq("cohort_id", cohortId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (!cancelled) {
        setMessages((data ?? []) as unknown as Message[]);
        setLoading(false);
      }
    }
    load();

    const channel = supabase
      .channel(`messages:${cohortId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `cohort_id=eq.${cohortId}`,
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
  }, [cohortId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;
    setSending(true);
    setContent("");
    const { error } = await supabase
      .from("messages")
      .insert({ cohort_id: cohortId, author_id: currentUserId, content: text });
    setSending(false);
    if (error) setContent(text); // restore on failure so nothing is lost
  }

  return (
    <Card className="flex h-[520px] flex-col">
      <div className="border-b border-[var(--color-line)] px-4 py-2.5">
        <span className="font-mono-tag text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
          Group chat
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
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
        <Button type="submit" disabled={sending || !content.trim()}>
          Send
        </Button>
      </form>
    </Card>
  );
}