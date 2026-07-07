// supabase/functions/calendar-feed/index.ts
//
// Deploy with: supabase functions deploy calendar-feed --no-verify-jwt
//
// --no-verify-jwt is required and deliberate: this endpoint is hit by calendar
// apps (Google Calendar, Apple Calendar) polling a plain URL, not by our own
// authenticated frontend. There is no Supabase session/JWT to verify. Auth
// happens entirely via the `token` query param below.
//
// Because this function uses the SERVICE ROLE key, it bypasses RLS on every
// table it touches. That means the authorization logic that normally lives in
// Postgres policies has to be re-implemented by hand, right here, correctly.
// Treat every query in this file as "no safety net" — the events/rsvps RLS
// policies (008 migration) do NOT apply to service-role queries.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function toIcsDate(iso: string): string {
  // ICS wants UTC as YYYYMMDDTHHMMSSZ
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token || token.length < 32) {
    return new Response("Missing or malformed token.", { status: 401 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const tokenHash = await sha256Hex(token);

  const { data: tokenRow, error: tokenErr } = await supabase
    .from("calendar_feed_tokens")
    .select("user_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (tokenErr || !tokenRow) {
    // Deliberately generic — don't distinguish "bad token" from "revoked
    // token" from "server error" in the response body. No reason to hand an
    // attacker a signal about which.
    return new Response("Invalid or revoked calendar feed token.", { status: 401 });
  }

  const userId = tokenRow.user_id;

  // Explicit scoping — this is the RLS-equivalent check, done by hand.
  const { data: memberships, error: memErr } = await supabase
    .from("cohort_memberships")
    .select("cohort_id")
    .eq("user_id", userId)
    .eq("status", "active");

  if (memErr) {
    return new Response("Internal error resolving cohort memberships.", { status: 500 });
  }

  const cohortIds = (memberships ?? []).map((m) => m.cohort_id);

  if (cohortIds.length === 0) {
    return new Response(emptyCalendar(), {
      headers: { "content-type": "text/calendar; charset=utf-8" },
    });
  }

  // Only events with a real start time can appear on a calendar. TBD-date
  // events are silently excluded — see comment in 008_events_rsvps.sql.
  const { data: events, error: eventsErr } = await supabase
    .from("events")
    .select("id, title, description, location, starts_at, ends_at")
    .in("cohort_id", cohortIds)
    .not("starts_at", "is", null);

  if (eventsErr) {
    return new Response("Internal error fetching events.", { status: 500 });
  }

  const { data: rsvps, error: rsvpErr } = await supabase
    .from("rsvps")
    .select("event_id, status")
    .eq("user_id", userId);

  if (rsvpErr) {
    return new Response("Internal error fetching RSVPs.", { status: 500 });
  }

  const rsvpByEvent = new Map((rsvps ?? []).map((r) => [r.event_id, r.status]));

  const vevents = (events ?? []).map((e) => {
    const rsvpStatus = rsvpByEvent.get(e.id); // "going" | "maybe" | "not_going" | undefined
    const icsStatus = rsvpStatus === "going" ? "CONFIRMED" : "TENTATIVE";
    const icsTransp = rsvpStatus === "going" || rsvpStatus === "maybe" ? "OPAQUE" : "TRANSPARENT";

    const dtStart = toIcsDate(e.starts_at);
    const dtEnd = e.ends_at ? toIcsDate(e.ends_at) : toIcsDate(e.starts_at); // point-in-time fallback

    return [
      "BEGIN:VEVENT",
      `UID:${e.id}@space3-calendar-feed`,
      `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${icsEscape(e.title)}`,
      e.description ? `DESCRIPTION:${icsEscape(e.description)}` : null,
      e.location ? `LOCATION:${icsEscape(e.location)}` : null,
      `STATUS:${icsStatus}`,
      `TRANSP:${icsTransp}`,
      "END:VEVENT",
    ].filter(Boolean).join("\r\n");
  });

  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Space3//Calendar Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Space³ Events",
    // Hint only — many clients (notably Google Calendar) ignore this and poll
    // on their own fixed schedule (often every several hours), regardless of
    // what's requested here. Set expectations accordingly in the UI copy.
    "X-PUBLISHED-TTL:PT1H",
    ...vevents,
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(calendar, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});

function emptyCalendar(): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Space3//Calendar Feed//EN",
    "X-WR-CALNAME:Space³ Events",
    "END:VCALENDAR",
  ].join("\r\n");
}