"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Tag, Button, Input, Label } from "@/components/ui";

type FeedState =
  | { status: "loading" }
  | { status: "off" }
  | { status: "on-hidden" } // a token exists, but we don't hold the raw value in memory
  | { status: "just-generated"; rawToken: string };

const FEED_FUNCTION_URL = process.env.NEXT_PUBLIC_CALENDAR_FEED_FUNCTION_URL
if (!FEED_FUNCTION_URL && process.env.NODE_ENV !== "production") {
  console.warn(
    "NEXT_PUBLIC_CALENDAR_FEED_FUNCTION_URL is not set — calendar feed links will be broken."
  );
}

function buildUrls(rawToken: string) {
  const https = `${FEED_FUNCTION_URL}?token=${rawToken}`;
  const webcal = https.replace(/^https:\/\//, "webcal://");
  return { https, webcal };
}

export default function CalendarFeedPanel() {
  const [state, setState] = useState<FeedState>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [confirmingTurnOff, setConfirmingTurnOff] = useState(false);
  const [copiedField, setCopiedField] = useState<"webcal" | "https" | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.rpc("has_calendar_feed_token");
      if (cancelled) return;
      if (error) {
        setError("Couldn't check your calendar feed status. Try reloading this page.");
        setState({ status: "off" });
        return;
      }
      setState({ status: data ? "on-hidden" : "off" });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleTurnOn() {
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("rotate_calendar_feed_token");
    if (error || !data) {
      setError("Couldn't turn on your calendar feed. Try again.");
      return;
    }
    setState({ status: "just-generated", rawToken: data as string });
  }

  async function handleRegenerate() {
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("rotate_calendar_feed_token");
    if (error || !data) {
      setError("Couldn't create a new link. Your old link is still active — try again.");
      return;
    }
    setState({ status: "just-generated", rawToken: data as string });
  }

  async function handleTurnOff() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("revoke_calendar_feed_token");
    if (error) {
      setError("Couldn't turn off your calendar feed. Try again.");
      return;
    }
    setConfirmingTurnOff(false);
    setState({ status: "off" });
  }

  async function handleCopy(value: string, field: "webcal" | "https") {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      setError("Couldn't copy automatically. Select and copy the link by hand.");
    }
  }

  return (
    <Card className="p-6">
      <h2 className="font-display text-xl">Calendar feed</h2>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        Subscribe once in Google Calendar or Apple Calendar to see every event
        in your cohorts alongside your own. It's one-way: your RSVP changes
        how the event looks (confirmed, tentative, or free), but RSVPing from
        your calendar app doesn't update Space³ — do that here instead.
        Calendar apps typically refresh a subscribed feed every few hours, not
        instantly. Events without a set date won't appear until one is added.
      </p>

      {error && (
        <p className="mt-4 text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      {state.status === "loading" && (
        <p className="mt-4 text-sm text-[var(--color-ink-faint)]">
          Checking your calendar feed…
        </p>
      )}

      {state.status === "off" && (
        <div className="mt-4">
          <Button variant="primary" onClick={handleTurnOn}>
            Turn on calendar feed
          </Button>
        </div>
      )}

      {state.status === "on-hidden" && (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <Tag tone="teal">On</Tag>
            <p className="text-sm text-[var(--color-ink)]">Your calendar feed is active.</p>
          </div>
          <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
            For privacy, we don&rsquo;t keep a copy of your feed link — if you
            need it again, get a new one. Your old link stops working as soon
            as you do.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={handleRegenerate}>
              Get a new link
            </Button>
            <Button variant="danger" onClick={() => setConfirmingTurnOff(true)}>
              Turn off
            </Button>
          </div>
        </div>
      )}

      {state.status === "just-generated" && (() => {
        const { webcal, https } = buildUrls(state.rawToken);
        return (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <Tag tone="amber">Copy now</Tag>
              <p className="text-sm text-[var(--color-ink)]">
                This is the only time you&rsquo;ll see this link.
              </p>
            </div>
            <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
              Anyone with this link can see your cohorts&rsquo; events, so
              don&rsquo;t post it publicly. Lost it later? Come back here and
              get a new one.
            </p>

            <div className="mt-4">
              <Label>Subscribe link (opens your calendar app directly)</Label>
              <div className="flex gap-2">
                <Input readOnly value={webcal} onFocus={(e) => e.target.select()} />
                <Button variant="secondary" onClick={() => handleCopy(webcal, "webcal")}>
                  {copiedField === "webcal" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <div className="mt-4">
              <Label>Link (if your calendar app needs a plain URL to paste in)</Label>
              <div className="flex gap-2">
                <Input readOnly value={https} onFocus={(e) => e.target.select()} />
                <Button variant="secondary" onClick={() => handleCopy(https, "https")}>
                  {copiedField === "https" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <div className="mt-5">
              <Button variant="ghost" onClick={() => setState({ status: "on-hidden" })}>
                Done
              </Button>
            </div>
          </div>
        );
      })()}

      {confirmingTurnOff && (
        <Card className="mt-4 border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-4">
          <p className="text-sm text-[var(--color-ink)]">Turn off your calendar feed?</p>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Your existing link stops working immediately. You can turn it back
            on any time, but you&rsquo;ll get a new link.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" onClick={handleTurnOff}>
              Yes, turn off
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingTurnOff(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </Card>
  );
}