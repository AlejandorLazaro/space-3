import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { createClient } from "@/lib/supabase/client";

dayjs.extend(utc);
dayjs.extend(timezone);

/** Matches the columns in 013_personal_availability.sql — not guessed. */
export interface RecurringAvailabilityRow {
  id: string;
  user_id: string;
  /** 0 = Sunday .. 6 = Saturday, matching dayjs's .day(). */
  day_of_week: number;
  start_time: string; // "HH:mm:ss"
  end_time: string;
  timezone: string; // IANA name
}

export interface AvailabilityOverrideRow {
  id: string;
  user_id: string;
  override_date: string; // "YYYY-MM-DD"
  start_time: string | null;
  end_time: string | null;
  timezone: string;
  is_available: boolean;
  note: string | null;
}

export interface ResolvedInterval {
  start: dayjs.Dayjs;
  end: dayjs.Dayjs;
}

export async function fetchRecurringAvailability(): Promise<RecurringAvailabilityRow[]> {
  const supabase = createClient();
  // RLS scopes this to the current user already — no explicit filter needed.
  const { data, error } = await supabase.from("availability_recurring").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function fetchAvailabilityOverrides(
  rangeStartDate: string,
  rangeEndDate: string
): Promise<AvailabilityOverrideRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("availability_overrides")
    .select("*")
    .gte("override_date", rangeStartDate)
    .lte("override_date", rangeEndDate);
  if (error) throw error;
  return data ?? [];
}

/**
 * For the settings management list, not the calendar view — not bound to
 * whatever range the calendar currently has on screen. Includes the last 7
 * days (so a just-passed override is still visible/editable for a moment)
 * plus everything upcoming.
 */
export async function fetchManagedOverrides(): Promise<AvailabilityOverrideRow[]> {
  const supabase = createClient();
  const cutoff = dayjs().subtract(7, "day").format("YYYY-MM-DD");
  const { data, error } = await supabase
    .from("availability_overrides")
    .select("*")
    .gte("override_date", cutoff)
    .order("override_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface NewRecurringAvailabilityInput {
  user_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
}

export async function insertRecurringAvailability(
  input: NewRecurringAvailabilityInput
): Promise<RecurringAvailabilityRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("availability_recurring")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data as RecurringAvailabilityRow;
}

export async function deleteRecurringAvailability(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("availability_recurring").delete().eq("id", id);
  if (error) throw error;
}

export async function updateRecurringAvailability(
  id: string,
  fields: Partial<{ start_time: string; end_time: string; day_of_week: number; timezone: string }>
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("availability_recurring").update(fields).eq("id", id);
  if (error) throw error;
}

export interface NewAvailabilityOverrideInput {
  user_id: string;
  override_date: string;
  start_time: string | null;
  end_time: string | null;
  timezone: string;
  is_available: boolean;
  note?: string | null;
}

export async function insertAvailabilityOverride(
  input: NewAvailabilityOverrideInput
): Promise<AvailabilityOverrideRow> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("availability_overrides")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data as AvailabilityOverrideRow;
}

export async function deleteAvailabilityOverride(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("availability_overrides").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Seeds a brand-new user with a default recurring pattern of "available
 * 6am-10pm every day" — i.e. implicitly unavailable 10pm-6am nightly,
 * achieved purely through the existing available-only recurring model with
 * no schema change, per the calendar UI-pass decision to stay single-
 * direction (available-only recurring rows; unavailable is just the gap).
 *
 * NOT WIRED to any call site yet — the actual signup/account-creation file
 * wasn't available to edit safely, so this is a ready-to-call helper. Call
 * it once, right after a new user's profile row is created.
 *
 * Uses the browser's detected timezone (dayjs.tz.guess()) since this runs
 * client-side at signup time, same assumption as the rest of this file.
 */
export async function seedDefaultAvailability(userId: string): Promise<void> {
  const tz = dayjs.tz.guess();
  const inputs: NewRecurringAvailabilityInput[] = Array.from({ length: 7 }, (_, day_of_week) => ({
    user_id: userId,
    day_of_week,
    start_time: "06:00:00",
    end_time: "22:00:00",
    timezone: tz,
  }));
  await Promise.all(inputs.map((input) => insertRecurringAvailability(input)));
}

/**
 * Subtracts `block` from each interval in `intervals`, splitting an interval
 * into two if the block falls entirely inside it, or trimming one edge if it
 * only overlaps partially. Still used within resolveAvailableBlocks, but now
 * only ever applied within a single date's own override rows (is_available:
 * false rows subtracting from is_available:true rows for that SAME date) —
 * never across a date's overrides against another date's recurring baseline,
 * which is what made the old cross-source subtraction order-dependent (see
 * the comment in resolveAvailableBlocks below for why that mattered).
 */
function subtractInterval(
  intervals: ResolvedInterval[],
  block: ResolvedInterval
): ResolvedInterval[] {
  const result: ResolvedInterval[] = [];
  for (const iv of intervals) {
    const noOverlap = !block.end.isAfter(iv.start) || !block.start.isBefore(iv.end);
    if (noOverlap) {
      result.push(iv);
      continue;
    }
    if (block.start.isAfter(iv.start)) result.push({ start: iv.start, end: block.start });
    if (block.end.isBefore(iv.end)) result.push({ start: block.end, end: iv.end });
    // else: block fully covers iv — dropped entirely, nothing pushed.
  }
  return result;
}

/**
 * Resolves the recurring baseline + date-specific overrides into concrete
 * available intervals for the given range.
 *
 * Precedence (rewritten): if ANY override exists for a given date, the
 * recurring baseline is ignored ENTIRELY for that date — the day's resolved
 * blocks come purely from that date's own override rows (is_available:true
 * rows are added, is_available:false rows are then subtracted from those,
 * in two clean passes). If no override exists for a date, the recurring
 * baseline applies unchanged.
 *
 * This matches Calendly's actual, confirmed behavior (a date-specific
 * override replaces the day's regular hours rather than layering on top of
 * them) rather than the previous purely-additive/subtractive model, which
 * had two problems: (1) it couldn't express "move this day's window from
 * 9-5 to 6-8pm" without the old 9-5 also still showing, which is exactly
 * what breaks drag-to-resize, and (2) same-day overrides were processed in
 * whatever order the query returned them, so an add-then-subtract vs.
 * subtract-then-add ordering could silently produce different results. The
 * two-pass structure here (all adds, then all subtracts, always within one
 * date's own overrides) is order-independent by construction — sequential
 * subtraction of exclusion zones from an accumulated set doesn't depend on
 * the order the subtractions are applied in.
 *
 * Each recurring/override row's own `timezone` is used to interpret its
 * wall-clock time into a real instant — not the browser's timezone — so
 * this stays correct regardless of what timezone the viewer happens to be
 * looking at the calendar from.
 */
export function resolveAvailableBlocks(
  recurring: RecurringAvailabilityRow[],
  overrides: AvailabilityOverrideRow[],
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs
): ResolvedInterval[] {
  const blocks: ResolvedInterval[] = [];
  let cursor = rangeStart.startOf("day");

  const overridesByDate = new Map<string, AvailabilityOverrideRow[]>();
  for (const o of overrides) {
    const list = overridesByDate.get(o.override_date) ?? [];
    list.push(o);
    overridesByDate.set(o.override_date, list);
  }

  while (cursor.isBefore(rangeEnd)) {
    const dateKey = cursor.format("YYYY-MM-DD");
    const todaysOverrides = overridesByDate.get(dateKey) ?? [];
    let dayBlocks: ResolvedInterval[] = [];

    if (todaysOverrides.length > 0) {
      // Overrides exist for this date — they replace the recurring
      // baseline entirely, rather than layering on top of it.
      for (const o of todaysOverrides) {
        if (!o.is_available) continue;
        const wholeDay = !o.start_time || !o.end_time;
        const oStart = wholeDay
          ? dayjs.tz(dateKey, o.timezone).startOf("day")
          : dayjs.tz(`${dateKey} ${o.start_time}`, o.timezone);
        const oEnd = wholeDay
          ? dayjs.tz(dateKey, o.timezone).endOf("day")
          : dayjs.tz(`${dateKey} ${o.end_time}`, o.timezone);
        dayBlocks.push({ start: oStart, end: oEnd });
      }
      for (const o of todaysOverrides) {
        if (o.is_available) continue;
        const wholeDay = !o.start_time || !o.end_time;
        const oStart = wholeDay
          ? dayjs.tz(dateKey, o.timezone).startOf("day")
          : dayjs.tz(`${dateKey} ${o.start_time}`, o.timezone);
        const oEnd = wholeDay
          ? dayjs.tz(dateKey, o.timezone).endOf("day")
          : dayjs.tz(`${dateKey} ${o.end_time}`, o.timezone);
        dayBlocks = subtractInterval(dayBlocks, { start: oStart, end: oEnd });
      }
    } else {
      for (const row of recurring) {
        const zonedDate = dayjs.tz(dateKey, row.timezone);
        if (zonedDate.day() !== row.day_of_week) continue;
        dayBlocks.push({
          start: dayjs.tz(`${dateKey} ${row.start_time}`, row.timezone),
          end: dayjs.tz(`${dateKey} ${row.end_time}`, row.timezone),
        });
      }
    }

    blocks.push(...dayBlocks);
    cursor = cursor.add(1, "day");
  }

  return blocks;
}