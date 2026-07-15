"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import ChatPanel from "@/components/ChatPanel";
import Popover from "@/components/Popover";
import { fetchEventChatTabs, describeEventChatLifecycle, type EventChatTabInfo } from "@/lib/calendar/chats";

const INLINE_EVENT_TAB_LIMIT = 3;
const HIDDEN_STORAGE_PREFIX = "space3.hiddenEventChats.";

// This app is a fully static export (output: 'export', no SSR at all — see
// space3-project-structure.md), so there's no hydration-mismatch risk in
// reading localStorage directly inside a useState initializer here.
function loadHidden(cohortId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(HIDDEN_STORAGE_PREFIX + cohortId);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveHidden(cohortId: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(HIDDEN_STORAGE_PREFIX + cohortId, JSON.stringify([...ids]));
  } catch {
    // localStorage can throw (private browsing, quota) — hiding is a
    // nice-to-have declutter feature, fail silently rather than surface an
    // error banner for something this low-stakes.
  }
}

function tabClasses(active: boolean, closed: boolean) {
  if (active) return "shrink-0 rounded-md bg-[var(--color-ink)] px-3 py-1.5 text-sm text-[var(--color-paper)]";
  return (
    "shrink-0 rounded-md px-3 py-1.5 text-sm hover:bg-black/5 " +
    (closed ? "text-[var(--color-ink-faint)]" : "text-[var(--color-ink-soft)]")
  );
}

export default function CohortChatTabs({
  cohortId,
  currentUserId,
}: {
  cohortId: string;
  currentUserId: string;
}) {
  const [eventTabs, setEventTabs] = useState<EventChatTabInfo[]>([]);
  const [activeTab, setActiveTab] = useState<string>("general"); // "general" | event_id
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => loadHidden(cohortId));

  useEffect(() => {
    setHiddenIds(loadHidden(cohortId));
  }, [cohortId]);

  useEffect(() => {
    let cancelled = false;
    fetchEventChatTabs(cohortId)
      .then((rows) => {
        if (!cancelled) setEventTabs(rows);
      })
      .catch((err) => {
        console.error("Failed to load event chat tabs:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [cohortId]);

  function hideEvent(eventId: string) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(eventId);
      saveHidden(cohortId, next);
      return next;
    });
    // Don't leave the user staring at a chat they just hid.
    setActiveTab((current) => (current === eventId ? "general" : current));
  }

  function unhideEvent(eventId: string) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(eventId);
      saveHidden(cohortId, next);
      return next;
    });
  }

  const visibleEventTabs = useMemo(
    () => eventTabs.filter((e) => !hiddenIds.has(e.event_id)),
    [eventTabs, hiddenIds]
  );
  const hiddenEventTabs = useMemo(
    () => eventTabs.filter((e) => hiddenIds.has(e.event_id)),
    [eventTabs, hiddenIds]
  );

  // Inline slots go to whichever visible events are temporally closest to
  // "now" (soonest upcoming, or most recently closed) — not straight
  // chronological order, which would bias the visible set toward whatever's
  // already closed (past dates sort first) and bury upcoming events behind it.
  const { inline, overflow } = useMemo(() => {
    const now = dayjs();
    const byCloseness = [...visibleEventTabs].sort(
      (a, b) =>
        Math.abs(dayjs(a.ends_at ?? a.starts_at).diff(now)) -
        Math.abs(dayjs(b.ends_at ?? b.starts_at).diff(now))
    );
    const inlineIds = new Set(byCloseness.slice(0, INLINE_EVENT_TAB_LIMIT).map((e) => e.event_id));
    return {
      // Keep chronological order for display, even though selection was by closeness.
      inline: visibleEventTabs.filter((e) => inlineIds.has(e.event_id)),
      overflow: visibleEventTabs.filter((e) => !inlineIds.has(e.event_id)),
    };
  }, [visibleEventTabs]);

  const activeEvent = eventTabs.find((e) => e.event_id === activeTab) ?? null;

  function renderEventTab(e: EventChatTabInfo) {
    return (
      <div key={e.event_id} className="group relative shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab(e.event_id)}
          className={tabClasses(activeTab === e.event_id, e.closed) + " pr-5"}
        >
          {e.event_title}
          {e.closed && <span className="ml-1 text-xs">(closed)</span>}
        </button>
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            hideEvent(e.event_id);
          }}
          aria-label={`Hide ${e.event_title} chat`}
          title="Hide this chat"
          className={
            "absolute right-1 top-1/2 -translate-y-1/2 text-xs leading-none " +
            (activeTab === e.event_id
              ? "text-[var(--color-paper)]/70 hover:text-[var(--color-paper)]"
              : "text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]")
          }
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={tabClasses(activeTab === "general", false)}
        >
          General
        </button>

        {inline.map(renderEventTab)}

        {overflow.length > 0 && (
          <Popover
            align="right"
            trigger={
              <button
                type="button"
                className="shrink-0 rounded-md px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-black/5"
              >
                More events ▾
              </button>
            }
          >
            <div className="flex max-h-64 w-56 flex-col gap-0.5 overflow-y-auto">
              {overflow.map((e) => (
                <div key={e.event_id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setActiveTab(e.event_id)}
                    // Note: doesn't auto-close the popover on selection —
                    // Popover's current API doesn't expose a way for a child
                    // to close it programmatically. Same known rough edge
                    // as before; clicking elsewhere or Escape closes it.
                    className={"w-full pr-6 text-left " + tabClasses(activeTab === e.event_id, e.closed)}
                  >
                    {e.event_title}
                    {e.closed && <span className="ml-1 text-xs">(closed)</span>}
                  </button>
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      hideEvent(e.event_id);
                    }}
                    aria-label={`Hide ${e.event_title} chat`}
                    title="Hide this chat"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs leading-none text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Popover>
        )}

        {hiddenEventTabs.length > 0 && (
          <Popover
            align="right"
            trigger={
              <button
                type="button"
                className="shrink-0 rounded-md px-2 py-1.5 text-xs text-[var(--color-ink-faint)] hover:bg-black/5"
              >
                Hidden ({hiddenEventTabs.length})
              </button>
            }
          >
            <div className="flex max-h-64 w-56 flex-col gap-0.5 overflow-y-auto">
              <p className="px-2 pb-1 text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                Hidden chats
              </p>
              {hiddenEventTabs.map((e) => (
                <div key={e.event_id} className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="truncate text-sm text-[var(--color-ink-soft)]">{e.event_title}</span>
                  <button
                    type="button"
                    onClick={() => unhideEvent(e.event_id)}
                    className="shrink-0 text-xs text-[var(--color-ink)] underline"
                  >
                    Show
                  </button>
                </div>
              ))}
            </div>
          </Popover>
        )}
      </div>

      {activeTab === "general" || !activeEvent ? (
        <ChatPanel
          cohortId={cohortId}
          currentUserId={currentUserId}
          title="Group chat"
          infoBanner="Messages older than 30 days are automatically deleted."
        />
      ) : activeEvent.chat_id ? (
        <ChatPanel
          chatId={activeEvent.chat_id}
          currentUserId={currentUserId}
          title={activeEvent.event_title}
          readOnly={activeEvent.closed}
          closedNotice="This event has ended — chat is read-only."
          infoBanner={describeEventChatLifecycle(
            activeEvent.ends_at ?? activeEvent.starts_at,
            activeEvent.chat_closes_after_hours
          )}
        />
      ) : (
        <p className="p-4 text-sm text-[var(--color-ink-faint)]">
          This event doesn&rsquo;t have a chat set up.
        </p>
      )}
    </div>
  );
}