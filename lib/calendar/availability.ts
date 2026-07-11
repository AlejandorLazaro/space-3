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
 * Subtracts `block` from each interval in `intervals`, splitting an interval
 * into two if the block falls entirely inside it, or trimming one edge if it
 * only overlaps partially. Runtime-verified against 4 scenarios (recurring
 * only, mid-window split, non-overlapping add, whole-day removal) before
 * this was written — see the accompanying test output.
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
 * available intervals for the given range. Precedence: overrides always win
 * over the recurring baseline for the date they apply to (an `is_available:
 * true` override adds a window regardless of what recurring says; an
 * `is_available: false` override subtracts from whatever recurring produced,
 * even down to zero).
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
    let dayBlocks: ResolvedInterval[] = [];

    for (const row of recurring) {
      const zonedDate = dayjs.tz(dateKey, row.timezone);
      if (zonedDate.day() !== row.day_of_week) continue;
      dayBlocks.push({
        start: dayjs.tz(`${dateKey} ${row.start_time}`, row.timezone),
        end: dayjs.tz(`${dateKey} ${row.end_time}`, row.timezone),
      });
    }

    const todaysOverrides = overridesByDate.get(dateKey) ?? [];
    for (const o of todaysOverrides) {
      const wholeDay = !o.start_time || !o.end_time;
      const oStart = wholeDay
        ? dayjs.tz(dateKey, o.timezone).startOf("day")
        : dayjs.tz(`${dateKey} ${o.start_time}`, o.timezone);
      const oEnd = wholeDay
        ? dayjs.tz(dateKey, o.timezone).endOf("day")
        : dayjs.tz(`${dateKey} ${o.end_time}`, o.timezone);

      if (o.is_available) {
        dayBlocks.push({ start: oStart, end: oEnd });
      } else {
        dayBlocks = subtractInterval(dayBlocks, { start: oStart, end: oEnd });
      }
    }

    blocks.push(...dayBlocks);
    cursor = cursor.add(1, "day");
  }

  return blocks;
}