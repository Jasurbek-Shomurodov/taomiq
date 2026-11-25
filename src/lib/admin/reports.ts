import { FINANCE_LIMITS, PAYMENT_METHODS, type PaymentMethod } from "./finance/categories";
import { addDays } from "./stats";

/*
 * Reports (docs/plans/zarkebab-feature-port.md, slice 5): the tabs, the period of the Reports screen and its Excel
 * export, the shapes the report functions return (migration 0021), and the few figures worked out from them. Pure
 * functions of their arguments: "today" is a Tashkent calendar day the caller reads once per request
 * (tashkentDay in lib/admin/stats.ts), so nothing here reads the clock.
 */

// ---------- tabs ----------

export const REPORT_TABS = ["overview", "programs", "time", "sources", "payments", "renewals", "staff", "orders"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];

export function isReportTab(value: unknown): value is ReportTab {
  return typeof value === "string" && (REPORT_TABS as readonly string[]).includes(value);
}

// ---------- period ----------

/** The quick choices of the period picker. The last 30 days is the default. */
export const REPORT_PRESETS = ["today", "7d", "30d", "month", "last_month", "year"] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];
export const DEFAULT_PRESET: ReportPreset = "30d";

export function isReportPreset(value: unknown): value is ReportPreset {
  return typeof value === "string" && (REPORT_PRESETS as readonly string[]).includes(value);
}

/** The longest period the report functions accept (0021: p_to - p_from <= 365). */
export const REPORT_MAX_DAYS = 366;
/** No period starts before the ledger's first day. */
export const REPORT_FIRST_DAY = FINANCE_LIMITS.firstDay;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day written as "YYYY-MM-DD" (not 2026-02-30). */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((day) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000) + 1;
}

export type ReportPeriod = {
  from: string;
  to: string;
  /** The preset that made it, or null for a custom from–to. */
  preset: ReportPreset | null;
  /** True when the address asked for a period that is not allowed and the default was used instead. */
  fellBack: boolean;
};

/** The days a preset covers on `today`. */
export function presetRange(preset: ReportPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const firstOfMonth = `${today.slice(0, 7)}-01`;
      const to = addDays(firstOfMonth, -1);
      return { from: `${to.slice(0, 7)}-01`, to };
    }
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** Whether a custom from–to may be shown: real days, from <= to <= today, from the ledger's first day, 366 days at most. */
export function isAllowedRange(from: string, to: string, today: string): boolean {
  return (
    isIsoDay(from) &&
    isIsoDay(to) &&
    from <= to &&
    to <= today &&
    from >= REPORT_FIRST_DAY &&
    daysBetween(from, to) <= REPORT_MAX_DAYS
  );
}

/**
 * The period an address asks for: `?period=<preset>`, else `?from=&to=` (a custom range), else the last 30 days.
 * Anything not allowed (a malformed or future day, from after to, longer than 366 days, before the ledger's first day,
 * an unknown preset) falls back to the last 30 days, with `fellBack` set so the page can say so. The page and the
 * Excel export both read the period through this function.
 */
export function resolveReportPeriod(
  params: { period?: string | null; from?: string | null; to?: string | null },
  today: string,
): ReportPeriod {
  const fallback = (fellBack: boolean): ReportPeriod => ({ ...presetRange(DEFAULT_PRESET, today), preset: DEFAULT_PRESET, fellBack });
  const { period, from, to } = params;
  if (period) {
    if (!isReportPreset(period)) return fallback(true);
    const range = presetRange(period, today);
    // "This year" and "last month" stay inside the ledger's dates: before them nothing can be recorded.
    const start = range.from < REPORT_FIRST_DAY ? REPORT_FIRST_DAY : range.from;
    if (start > range.to) return fallback(true);
    return { from: start, to: range.to, preset: period, fellBack: false };
  }
  if (!from && !to) return fallback(false);
  if (from && to && isAllowedRange(from, to, today)) return { from, to, preset: null, fellBack: false };
  return fallback(true);
}

/** The previous period of equal length, right before this one (as report_overview compares). */
export function previousPeriod(period: { from: string; to: string }): { from: string; to: string } {
  const length = daysBetween(period.from, period.to);
  return { from: addDays(period.from, -length), to: addDays(period.from, -1) };
}

/** The period's own parameters: the preset, or from and to. The default (30 days) writes nothing. */
export function periodParams(period: Pick<ReportPeriod, "from" | "to" | "preset">): [string, string][] {
  if (period.preset) return period.preset === DEFAULT_PRESET ? [] : [["period", period.preset]];
  return [
    ["from", period.from],
    ["to", period.to],
  ];
}

const BASE_PATH = "/reports";

/** The Reports screen's address: tab, period and the history page together, so each keeps the others. */
export function reportsHref({
  tab,
  period,
  page = 1,
}: {
  tab: ReportTab;
  period: Pick<ReportPeriod, "from" | "to" | "preset">;
  page?: number;
}): string {
  const params = new URLSearchParams();
  if (tab !== "overview") params.set("tab", tab);
  for (const [key, value] of periodParams(period)) params.set(key, value);
  if (tab === "orders" && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${BASE_PATH}?${query}` : BASE_PATH;
}

/** What one Excel file holds (the export route's ?what=). */
export const EXPORT_KINDS = ["reports", "finance", "payroll", "orders"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === "string" && (EXPORT_KINDS as readonly string[]).includes(value);
}

/**
 * The address of an Excel download (src/app/admin/(panel)/reports/export/route.ts). A plain link, never a client
 * navigation: the response is a file. The route reads the period with resolveReportPeriod, like the page.
 */
export function exportHref(what: ExportKind, period: Pick<ReportPeriod, "from" | "to" | "preset">): string {
  const params = new URLSearchParams({ what });
  // Always explicit, so the file matches what the screen showed even when the default changes.
  if (period.preset) params.set("period", period.preset);
  else {
    params.set("from", period.from);
    params.set("to", period.to);
  }
  return `${BASE_PATH}/export?${params.toString()}`;
}

/** A custom from–to for the finance screens' exports (a month of records, the payroll's month so far). */
export function customPeriod(from: string, to: string): Pick<ReportPeriod, "from" | "to" | "preset"> {
  return { from, to, preset: null };
}

// ---------- report shapes (migration 0021) ----------

export type OverviewFigures = {
  orders: number;
  revenue: number;
  /** Null without orders. */
  avg_order: number | null;
  avg_days: number | null;
  ration_days: number;
  customers: number;
  new_customers: number;
  returning_customers: number;
  placed: number;
  cancelled: number;
};

export type OverviewReport = {
  previous_from: string;
  previous_to: string;
  current: OverviewFigures;
  previous: OverviewFigures;
};

export type ProgramReportRow = {
  program_id: string | null;
  program_name: string;
  kcal: number | null;
  orders: number;
  ration_days: number;
  revenue: number;
};

export type ProgramsReport = { orders: number; revenue: number; ration_days: number; rows: ProgramReportRow[] };

export type DurationsReport = {
  by_days: { days: number; orders: number; revenue: number }[];
  by_schedule: { weekdays_only: boolean; orders: number; revenue: number }[];
};

export type TimeReport = {
  orders: number;
  /** Only cells with orders. dow is ISO (1 = Monday … 7 = Sunday), hour 0–23 in Tashkent. */
  cells: { dow: number; hour: number; orders: number }[];
};

export type SourceReportRow = {
  /**
   * null = direct (no tag), "staff" = added in the back office (never a visitor's own tag: one that reads "staff"
   * comes back as "staff?", an ordinary source).
   */
  source: string | null;
  placed: number;
  converted: number;
  paid: number;
  revenue: number;
};

/** The sources past the function's 199 rows, summed (null when there are none). */
export type OtherSources = Omit<SourceReportRow, "source"> & { sources: number };

export type SourcesReport = { rows: SourceReportRow[]; other: OtherSources | null };

export type PaymentMethodRow = {
  /** null = not recorded (orders paid before payment methods were kept). */
  method: PaymentMethod | null;
  orders: number;
  revenue: number;
};

export type PaymentMethodsReport = { orders: number; revenue: number; rows: PaymentMethodRow[] };

export type RenewalsReport = {
  ended: number;
  renewed: number;
  waiting: number;
  early: number;
  avg_gap_days: number | null;
};

export type StaffReportRow = {
  /** "" when no name was ever kept. */
  name: string;
  in_team: boolean;
  added: number;
  added_paid: number;
  moves: number;
  to_paid: number;
  to_cancelled: number;
};

export type StaffReport = { rows: StaffReportRow[] };

export type ReportOrderRow = {
  id: string;
  number: number;
  status: string;
  paid_day: string;
  paid_at: string;
  program_name: string;
  kcal: number | null;
  days: number;
  weekdays_only: boolean;
  start_date: string;
  total: number;
  payment_method: PaymentMethod | null;
  by_staff: boolean;
};

export type OrdersReport = { page: number; pages: number; count: number; revenue: number; rows: ReportOrderRow[] };

/** Rows a page of the order history shows. */
export const REPORT_ORDERS_PAGE_SIZE = 50;

// ---------- figures worked out from the reports ----------

/** part / whole as 0..1, or null when the whole is 0. */
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** Whole-number percentage change, or null when there is nothing to compare with (the earlier figure is 0 or unknown). */
export function changeOf(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * The renewal rate, 0..1: renewed over the customers whose 14 days are over (still-waiting customers can still renew,
 * so they are left out rather than counted as lost). Null when nobody is decided yet.
 */
export function renewalRate(report: RenewalsReport): number | null {
  return shareOf(report.renewed, report.ended - report.waiting);
}

/** The 7 × 24 grid of the time report (rows Monday..Sunday, columns 0..23), zeros where there were no orders. */
export function timeGrid(report: TimeReport): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const cell of report.cells) {
    if (cell.dow >= 1 && cell.dow <= 7 && cell.hour >= 0 && cell.hour <= 23) grid[cell.dow - 1][cell.hour] += cell.orders;
  }
  return grid;
}

/** Orders per hour of the day (0..23), all weekdays together. */
export function hourTotals(grid: number[][]): number[] {
  return Array.from({ length: 24 }, (_, hour) => grid.reduce((sum, row) => sum + row[hour], 0));
}

/** Orders per weekday (Monday..Sunday), all hours together. */
export function weekdayTotals(grid: number[][]): number[] {
  return grid.map((row) => row.reduce((sum, n) => sum + n, 0));
}

/** The payment methods in display order, "not recorded" last. */
export const PAYMENT_ROW_ORDER: (PaymentMethod | null)[] = [...PAYMENT_METHODS, null];
