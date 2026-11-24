import "server-only";
import { requireStaff } from "./auth";
import { ORDER_STATUSES, isOrderStatus, type OrderStatus } from "./orders";

/*
 * Figures for the overview (docs/plans/admin-portal-upgrade.md, "Dashboard"). One loader reads orders through the
 * signed-in owner's session; everything else here is a pure function of its arguments (rows and "now"), so it can be
 * checked without a database.
 *
 * Rules every figure follows:
 * - Days are calendar days in Asia/Tashkent.
 * - A count is every order placed, whatever happened to it later; a value (sum of `total`) leaves cancelled orders out.
 * - A change against a previous figure is null when there is nothing to compare with (previous = 0): no percentage.
 */

export const STATS_TIME_ZONE = "Asia/Tashkent";
/** Days read from the database: the 30-day period and the 30 days before it, for the comparison. */
export const STATS_WINDOW_DAYS = 60;
/** Days in the chart and the breakdowns. */
export const STATS_PERIOD_DAYS = 30;
const PAGE_SIZE = 1000;
/** The most rows the overview aggregates in the page; past it the figures are marked partial. */
export const STATS_ROW_CAP = 5000;
/** Sources shown by name; the rest are summed into one "other" row. */
const SOURCE_ROWS = 6;

/**
 * The only order columns the overview reads: no name, phone, address or note. `source` holds the UTM tags and `ref`
 * the order form kept (lib/order/rules.ts SOURCE_KEYS), nothing about the person.
 */
const STATS_COLUMNS = "created_at, status, total, program_name, kcal, source";

export type StatsOrder = {
  created_at: string;
  status: string;
  total: number | string | null;
  program_name: string | null;
  kcal: number | null;
  source: Record<string, unknown> | null;
};

// ---------- days in Tashkent ----------

const dayParts = new Intl.DateTimeFormat("en-US", {
  timeZone: STATS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeParts = new Intl.DateTimeFormat("en-US", {
  timeZone: STATS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(format: Intl.DateTimeFormat, instant: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of format.formatToParts(instant)) if (part.type !== "literal") out[part.type] = Number(part.value);
  return out;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The calendar day of an instant in Tashkent, as "YYYY-MM-DD". Null for a timestamp that does not parse. */
export function tashkentDay(instant: Date | string): string | null {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return null;
  const p = parts(dayParts, date);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** "YYYY-MM-DD" moved by whole days (calendar arithmetic, no time zone involved). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The instant a Tashkent calendar day starts, as an ISO timestamp (for a created_at >= filter). */
export function dayStartInstant(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // The zone's offset at that moment: its wall clock read as if it were UTC, minus the real instant.
  const p = parts(timeParts, new Date(guess));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
  return new Date(guess - offset).toISOString();
}

// ---------- aggregation ----------

export type Tally = { orders: number; value: number };

export type DayBar = Tally & { day: string; isToday: boolean };

export type ShareRow = Tally & {
  key: string;
  /** Share of the period's orders, 0..1. */
  share: number;
};

export type ProgramRow = ShareRow & { name: string; kcal: number | null };

/**
 * One row of "where orders come from". `kind` says what the row is; only a "source" row has a `label` (the tag as
 * written). Keys cannot collide with a real tag: `src:<tag>`, `__direct`, `__other`.
 */
export type SourceRow = ShareRow & { kind: "source" | "direct" | "other"; label: string | null };

export type OrdersSummary = {
  /** Today so far. */
  today: Tally;
  /** The whole of yesterday. */
  yesterday: Tally;
  /** Yesterday up to the same time of day as now: what "today so far" is compared with. */
  yesterdaySoFar: Tally;
  /** The last 30 days, today (so far) included, oldest first. */
  days: DayBar[];
  period: Tally;
  /** The same stretch 30 days earlier: from the start of day -59 up to now minus 30 days. */
  previous: Tally;
  byStatus: Record<OrderStatus, number>;
  byProgram: ProgramRow[];
  bySource: SourceRow[];
};

/** Whole-number percentage change, or null when the previous figure is 0 (or unknown) and there is nothing to compare. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function amount(total: StatsOrder["total"]): number {
  const n = Number(total);
  return Number.isFinite(n) ? n : 0;
}

function add(tally: Tally, order: StatsOrder) {
  tally.orders += 1;
  if (order.status !== "cancelled") tally.value += amount(order.total);
}

const empty = (): Tally => ({ orders: 0, value: 0 });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where an order came from: its utm_source, else its ref, lower-cased; null when it carried neither. */
export function sourceOf(source: StatsOrder["source"]): string | null {
  if (!source || typeof source !== "object") return null;
  for (const key of ["utm_source", "ref"] as const) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
  }
  return null;
}

/**
 * Every overview figure from the orders of the last 60 days. `now` decides which Tashkent day is today; rows outside
 * the 60 days, after `now`, or with a timestamp that does not parse are ignored, so the caller may pass a wider set.
 * Comparisons are like for like: today so far against yesterday up to the same time (now − 24 h; Tashkent has no
 * daylight saving), and the 30 days so far against the same stretch 30 days earlier (up to now − 30 days).
 */
export function summarizeOrders(rows: readonly StatsOrder[], now: Date): OrdersSummary {
  const nowMs = now.getTime();
  const today = tashkentDay(now)!;
  const yesterday = addDays(today, -1);
  const periodStart = addDays(today, -(STATS_PERIOD_DAYS - 1));
  const previousStart = addDays(today, -(STATS_WINDOW_DAYS - 1));
  const yesterdayCut = nowMs - DAY_MS;
  const previousCut = nowMs - STATS_PERIOD_DAYS * DAY_MS;

  const byDay = new Map<string, Tally>();
  for (let i = STATS_PERIOD_DAYS - 1; i >= 0; i--) byDay.set(addDays(today, -i), empty());

  const yesterdaySoFar = empty();
  const previous = empty();
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  const programs = new Map<string, Tally & { name: string; kcal: number | null }>();
  const sources = new Map<string | null, Tally>();

  for (const order of rows) {
    const at = new Date(order.created_at).getTime();
    if (Number.isNaN(at) || at > nowMs) continue;
    const day = tashkentDay(new Date(at))!;
    // "YYYY-MM-DD" strings compare in calendar order.
    if (day < previousStart) continue;
    if (day < periodStart) {
      if (at <= previousCut) add(previous, order);
      continue;
    }

    add(byDay.get(day)!, order);
    if (day === yesterday && at <= yesterdayCut) add(yesterdaySoFar, order);
    if (isOrderStatus(order.status)) byStatus[order.status] += 1;

    const name = order.program_name?.trim() || "—";
    const kcal = typeof order.kcal === "number" && Number.isFinite(order.kcal) ? order.kcal : null;
    const programKey = `${name}\u0000${kcal ?? ""}`;
    const program = programs.get(programKey) ?? { ...empty(), name, kcal };
    add(program, order);
    programs.set(programKey, program);

    const sourceKey = sourceOf(order.source);
    const source = sources.get(sourceKey) ?? empty();
    add(source, order);
    sources.set(sourceKey, source);
  }

  const days: DayBar[] = [...byDay].map(([day, tally]) => ({ day, ...tally, isToday: day === today }));
  const period = days.reduce((sum, d) => ({ orders: sum.orders + d.orders, value: sum.value + d.value }), empty());
  const share = (orders: number) => (period.orders > 0 ? orders / period.orders : 0);
  const byOrdersThenValue = (a: Tally, b: Tally) => b.orders - a.orders || b.value - a.value;

  const byProgram: ProgramRow[] = [...programs]
    .map(([key, p]) => ({ key, name: p.name, kcal: p.kcal, orders: p.orders, value: p.value, share: share(p.orders) }))
    .sort((a, b) => byOrdersThenValue(a, b) || a.name.localeCompare(b.name) || (a.kcal ?? 0) - (b.kcal ?? 0));

  const sourceRows: SourceRow[] = [...sources]
    .map(([label, s]): SourceRow => ({
      kind: label === null ? "direct" : "source",
      key: label === null ? "__direct" : `src:${label}`,
      label,
      orders: s.orders,
      value: s.value,
      share: share(s.orders),
    }))
    .sort((a, b) => byOrdersThenValue(a, b) || a.key.localeCompare(b.key));
  let bySource = sourceRows;
  if (sourceRows.length > SOURCE_ROWS + 1) {
    const rest = sourceRows.slice(SOURCE_ROWS).reduce(
      (sum, s) => ({ orders: sum.orders + s.orders, value: sum.value + s.value }),
      empty(),
    );
    bySource = [
      ...sourceRows.slice(0, SOURCE_ROWS),
      { kind: "other", key: "__other", label: null, ...rest, share: share(rest.orders) },
    ];
  }

  return {
    today: { ...byDay.get(today)! },
    yesterday: { ...byDay.get(yesterday)! },
    yesterdaySoFar,
    days,
    period,
    previous,
    byStatus,
    byProgram,
    bySource,
  };
}

// ---------- loader ----------

/**
 * Reads rows page by page (`fetchPage(from, to)`, inclusive offsets) up to `cap`. `partial` is true only when a row
 * past the cap exists, checked with one extra one-row read; a window of exactly `cap` rows is complete.
 */
export async function readCapped<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  cap: number = STATS_ROW_CAP,
  pageSize: number = PAGE_SIZE,
): Promise<{ rows: T[]; partial: boolean }> {
  const rows: T[] = [];
  while (rows.length < cap) {
    const want = Math.min(pageSize, cap - rows.length);
    const chunk = await fetchPage(rows.length, rows.length + want - 1);
    rows.push(...chunk);
    if (chunk.length < want) return { rows, partial: false };
  }
  const beyond = await fetchPage(cap, cap);
  return { rows, partial: beyond.length > 0 };
}

export type OrderStats = {
  /** Null when the orders could not be read. */
  summary: OrdersSummary | null;
  /** True when the window holds more rows than the cap: the oldest days are missing. */
  partial: boolean;
  /** All-time counts by current status (head-only, no rows); null when that count failed. */
  waiting: number | null;
  active: number | null;
  /** Paid and about to start: the line under "active". */
  paid: number | null;
};

function logFailure(what: string, error: unknown) {
  console.error(`overview: ${what} failed`, error instanceof Error ? error.message : error);
}

/**
 * The owner's order figures. Orders hold personal data, so this reads through the signed-in session (RLS returns
 * orders to the owner only) and returns null for anyone else without querying. Each part fails on its own: a failed
 * count is null, a failed row read leaves `summary` null, and neither throws.
 */
export async function loadOrderStats(at?: Date): Promise<OrderStats | null> {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") return null;
  // Read the clock only after the session (a request-time read), so the time is the request's.
  const now = at ?? new Date();

  const count = async (status: OrderStatus): Promise<number | null> => {
    try {
      const { count: n, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (error) throw new Error(error.message);
      return n ?? 0;
    } catch (error) {
      logFailure(`${status} count`, error);
      return null;
    }
  };

  const readRows = async (): Promise<{ rows: StatsOrder[]; partial: boolean } | null> => {
    const since = dayStartInstant(addDays(tashkentDay(now)!, -(STATS_WINDOW_DAYS - 1)));
    // Frozen at `now`: an order placed while the pages are read would shift the offsets and repeat a row.
    const until = now.toISOString();
    // Newest first, so a cut at the cap drops the oldest days, never today. `id` breaks ties between equal
    // timestamps so pages neither repeat nor skip a row.
    const page = (from: number, to: number) =>
      supabase
        .from("orders")
        .select(STATS_COLUMNS)
        .gte("created_at", since)
        .lte("created_at", until)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to);
    try {
      return await readCapped<StatsOrder>(async (from, to) => {
        const { data, error } = await page(from, to);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as StatsOrder[];
      });
    } catch (error) {
      logFailure("orders read", error);
      return null;
    }
  };

  const [result, waiting, active, paid] = await Promise.all([readRows(), count("new"), count("active"), count("paid")]);
  return {
    summary: result ? summarizeOrders(result.rows, now) : null,
    partial: result?.partial ?? false,
    waiting,
    active,
    paid,
  };
}
