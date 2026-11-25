import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPaymentMethod } from "./finance/categories";
import {
  REPORT_ORDERS_PAGE_SIZE,
  type DurationsReport,
  type OrdersReport,
  type OverviewFigures,
  type OverviewReport,
  type PaymentMethodsReport,
  type ProgramsReport,
  type RenewalsReport,
  type ReportOrderRow,
  type SourcesReport,
  type StaffReport,
  type TimeReport,
} from "./reports";

/*
 * The report functions of migration 0021, read through the signed-in owner's session client. Each refuses anyone but
 * the owner (not_owner) and a period longer than 366 days (bad_period). Every loader throws on a failed read, so the
 * caller decides what to show (the page: a notice and no figures; the export: an error response). Numbers come back
 * as JSON numbers; anything missing or malformed reads as 0 (counts) or null (averages), never as a made-up figure.
 */

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(obj) : [];
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function call(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Json> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return obj(data);
}

const range = (from: string, to: string) => ({ p_from: from, p_to: to });

function figures(value: unknown): OverviewFigures {
  const f = obj(value);
  return {
    orders: num(f.orders),
    revenue: num(f.revenue),
    avg_order: numOrNull(f.avg_order),
    avg_days: numOrNull(f.avg_days),
    ration_days: num(f.ration_days),
    customers: num(f.customers),
    new_customers: num(f.new_customers),
    returning_customers: num(f.returning_customers),
    placed: num(f.placed),
    cancelled: num(f.cancelled),
  };
}

export async function loadOverviewReport(supabase: SupabaseClient, from: string, to: string): Promise<OverviewReport> {
  const data = await call(supabase, "report_overview", range(from, to));
  return {
    previous_from: str(data.previous_from),
    previous_to: str(data.previous_to),
    current: figures(data.current),
    previous: figures(data.previous),
  };
}

export async function loadProgramsReport(supabase: SupabaseClient, from: string, to: string): Promise<ProgramsReport> {
  const data = await call(supabase, "report_programs", range(from, to));
  return {
    orders: num(data.orders),
    revenue: num(data.revenue),
    ration_days: num(data.ration_days),
    rows: list(data.rows).map((row) => ({
      program_id: typeof row.program_id === "string" ? row.program_id : null,
      program_name: str(row.program_name).trim() || "—",
      kcal: numOrNull(row.kcal),
      orders: num(row.orders),
      ration_days: num(row.ration_days),
      revenue: num(row.revenue),
    })),
  };
}

export async function loadDurationsReport(supabase: SupabaseClient, from: string, to: string): Promise<DurationsReport> {
  const data = await call(supabase, "report_durations", range(from, to));
  return {
    by_days: list(data.by_days).map((row) => ({ days: num(row.days), orders: num(row.orders), revenue: num(row.revenue) })),
    by_schedule: list(data.by_schedule).map((row) => ({
      weekdays_only: row.weekdays_only === true,
      orders: num(row.orders),
      revenue: num(row.revenue),
    })),
  };
}

export async function loadTimeReport(supabase: SupabaseClient, from: string, to: string): Promise<TimeReport> {
  const data = await call(supabase, "report_time", range(from, to));
  return {
    orders: num(data.orders),
    cells: list(data.cells).map((cell) => ({ dow: num(cell.dow), hour: num(cell.hour), orders: num(cell.orders) })),
  };
}

export async function loadSourcesReport(supabase: SupabaseClient, from: string, to: string): Promise<SourcesReport> {
  const data = await call(supabase, "report_sources", range(from, to));
  const other = data.other && typeof data.other === "object" ? obj(data.other) : null;
  return {
    rows: list(data.rows).map((row) => ({
      source: typeof row.source === "string" && row.source ? row.source : null,
      placed: num(row.placed),
      converted: num(row.converted),
      paid: num(row.paid),
      revenue: num(row.revenue),
    })),
    other: other
      ? {
          sources: num(other.sources),
          placed: num(other.placed),
          converted: num(other.converted),
          paid: num(other.paid),
          revenue: num(other.revenue),
        }
      : null,
  };
}

export async function loadPaymentMethodsReport(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<PaymentMethodsReport> {
  const data = await call(supabase, "report_payment_methods", range(from, to));
  return {
    orders: num(data.orders),
    revenue: num(data.revenue),
    rows: list(data.rows).map((row) => ({
      method: isPaymentMethod(row.method) ? row.method : null,
      orders: num(row.orders),
      revenue: num(row.revenue),
    })),
  };
}

export async function loadRenewalsReport(supabase: SupabaseClient, from: string, to: string): Promise<RenewalsReport> {
  const data = await call(supabase, "report_renewals", range(from, to));
  return {
    ended: num(data.ended),
    renewed: num(data.renewed),
    waiting: num(data.waiting),
    early: num(data.early),
    avg_gap_days: numOrNull(data.avg_gap_days),
  };
}

export async function loadStaffReport(supabase: SupabaseClient, from: string, to: string): Promise<StaffReport> {
  const data = await call(supabase, "report_staff", range(from, to));
  return {
    rows: list(data.rows).map((row) => ({
      name: str(row.name).trim(),
      in_team: row.in_team === true,
      added: num(row.added),
      added_paid: num(row.added_paid),
      moves: num(row.moves),
      to_paid: num(row.to_paid),
      to_cancelled: num(row.to_cancelled),
    })),
  };
}

function orderRow(row: Json): ReportOrderRow {
  return {
    id: str(row.id),
    number: num(row.number),
    status: str(row.status),
    paid_day: str(row.paid_day),
    paid_at: str(row.paid_at),
    program_name: str(row.program_name).trim() || "—",
    kcal: numOrNull(row.kcal),
    days: num(row.days),
    weekdays_only: row.weekdays_only === true,
    start_date: str(row.start_date),
    total: num(row.total),
    payment_method: isPaymentMethod(row.payment_method) ? row.payment_method : null,
    by_staff: row.by_staff === true,
  };
}

/** Where a keyset read continues: the last row of the previous call, and the moment the whole read is taken at. */
export type OrdersCursor = { asOf: string; beforeAt: string | null; beforeNumber: number | null };

/**
 * One page of the order history (the database clamps a page past the end to the last one). With a cursor, the rows
 * below its row instead of a numbered page, leaving out orders paid after `asOf` (loadAllReportOrders).
 */
export async function loadOrdersReport(
  supabase: SupabaseClient,
  from: string,
  to: string,
  page: number,
  pageSize: number = REPORT_ORDERS_PAGE_SIZE,
  cursor: OrdersCursor | null = null,
): Promise<OrdersReport> {
  const data = await call(supabase, "report_orders", {
    ...range(from, to),
    p_page: page,
    p_page_size: pageSize,
    p_as_of: cursor?.asOf ?? null,
    p_before_at: cursor?.beforeAt ?? null,
    p_before_number: cursor?.beforeNumber ?? null,
  });
  return {
    page: Math.max(1, num(data.page)),
    pages: Math.max(1, num(data.pages)),
    count: num(data.count),
    revenue: num(data.revenue),
    rows: list(data.rows).map(orderRow),
  };
}

/** The most rows one export page reads, and the most pages: a year of orders fits many times over. */
const EXPORT_PAGE_SIZE = 5000;
const EXPORT_MAX_PAGES = 20;

/**
 * Every order of the period for the Excel file, as one consistent set: the moment `asOf` is taken once and every call
 * leaves out orders paid after it, and each call continues below the last row of the one before (a keyset on the
 * payment time and the number, the list's own order), so a payment or a cancellation during the export neither
 * repeats nor skips a row. `partial` when the cap cut the list.
 */
export async function loadAllReportOrders(
  supabase: SupabaseClient,
  from: string,
  to: string,
  asOf: Date = new Date(),
): Promise<{ rows: ReportOrderRow[]; partial: boolean }> {
  const rows: ReportOrderRow[] = [];
  const cursor: OrdersCursor = { asOf: asOf.toISOString(), beforeAt: null, beforeNumber: null };
  for (let call = 1; call <= EXPORT_MAX_PAGES; call++) {
    const result = await loadOrdersReport(supabase, from, to, 1, EXPORT_PAGE_SIZE, cursor);
    rows.push(...result.rows);
    const last = result.rows.at(-1);
    if (result.rows.length < EXPORT_PAGE_SIZE || !last) return { rows, partial: false };
    cursor.beforeAt = last.paid_at;
    cursor.beforeNumber = last.number;
  }
  return { rows, partial: true };
}
