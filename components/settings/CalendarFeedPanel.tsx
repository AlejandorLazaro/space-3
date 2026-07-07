"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, Tag, Button, Input, Label } from "@/components/ui";

type FeedState =
  | { status: "loading" }
  | { status: "off" }
  | { status: "on-hidden" } // a token exists, but we don't hold the raw value in memory
  | { status: "just-generated"; rawToken: string };

const FEED_FUNCTION_URL = process.env.NEXT_PUBLIC_CALENDAR_FEED_FUNCTION_URL ?? "";

if (!FEED_FUNCTION_URL && process.env.NODE_ENV !== "production") {
  console.warn(
    "NEXT_PUBLIC_CALENDAR_FEED_FUNCTION_URL is not set — calendar feed links will be broken."
  );
}

function buildUrls(rawToken: string) {
  const https = `${FEED_FUNCTION_URL}?token=${rawToken}`;
  const webcal = https.replace(/^https:\/\//, "webcal://");
  // Google Calendar's documented "add calendar by URL" endpoint — accepts a
  // webcal:// or https:// feed URL via the `cid` param and opens Google
  // Calendar's own "subscribe?" confirmation screen.
  const googleAddUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  return { https, webcal, googleAddUrl };
}

export default function CalendarFeedPanel() {
  const [state, setState] = useState<FeedState>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [confirmingTurnOff, setConfirmingTurnOff] = useState(false);
  const [copiedField, setCopiedField] = useState<"link" | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.rpc("has_calendar_feed_token");
      if (cancelled) return;
      if (error) {
        console.error("has_calendar_feed_token failed:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
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
      console.error("rotate_calendar_feed_token (turn on) failed:", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        gotData: Boolean(data),
      });
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
      console.error("rotate_calendar_feed_token (regenerate) failed:", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        gotData: Boolean(data),
      });
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
      console.error("revoke_calendar_feed_token failed:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      setError("Couldn't turn off your calendar feed. Try again.");
      return;
    }
    setConfirmingTurnOff(false);
    setState({ status: "off" });
  }

  function handleAddApple(webcalUrl: string) {
    // Apple's Calendar app (iOS and macOS) is registered as the OS handler
    // for the webcal:// scheme — navigating to it hands off directly to a
    // native "Subscribe to this calendar?" prompt, no copying required.
    window.location.href = webcalUrl;
  }

  function handleAddGoogle(googleAddUrl: string) {
    window.open(googleAddUrl, "_blank", "noopener,noreferrer");
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField("link");
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error("clipboard write failed:", err);
      setError("Couldn't copy automatically. Select and copy the link by hand.");
    }
  }

  return (
    <Card className="p-6">
      <h2 className="font-display text-xl">Calendar feed</h2>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        See your cohorts&rsquo; events in your own calendar, automatically.
      </p>
      <Button
        variant="ghost"
        className="mt-1 h-auto p-0 text-sm underline underline-offset-2"
        onClick={() => setShowHowItWorks((v) => !v)}
      >
        {showHowItWorks ? "Hide details" : "How this works"}
      </Button>
      {showHowItWorks && (
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          RSVPing here changes how an event looks in your calendar (confirmed,
          tentative, or free) — but RSVPing from your calendar app doesn&rsquo;t
          update Space³, so do that here instead. New and changed events
          usually take a few hours to show up, not instantly. Events without a
          date yet won&rsquo;t appear until one&rsquo;s set.
        </p>
      )}

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
            We don&rsquo;t keep a copy of your link — if you need it again,
            get a new one. Your old link stops working the moment you do.
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
        const { webcal, https, googleAddUrl } = buildUrls(state.rawToken);
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
              don&rsquo;t share it. Lost it later? Come back here and get a
              new one.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => handleAddApple(webcal)}>
                Add to Apple Calendar
              </Button>
              <Button variant="secondary" onClick={() => handleAddGoogle(googleAddUrl)}>
                Add to Google Calendar
              </Button>
            </div>

            <div className="mt-4">
              <Label>Using a different calendar app? Paste this link in</Label>
              <div className="flex gap-2">
                <Input readOnly value={https} onFocus={(e) => e.target.select()} />
                <Button variant="secondary" onClick={() => handleCopy(https)}>
                  {copiedField === "link" ? "Copied" : "Copy"}
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