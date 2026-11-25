import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUSTOMERS_PAGE_SIZE,
  CUSTOMER_FILTERS,
  isCustomerState,
  type CustomerCounts,
  type CustomerDetail,
  type CustomerFilter,
  type CustomerOrder,
  type CustomerRow,
} from "./customers";

/*
 * Reads of the customer functions of migration 0020, through the signed-in session. The functions refuse anyone but
 * owners and managers (not_allowed), and return total_paid to the owner only. They throw on a failed read; the pages
 * turn that into a notice. Rows hold personal data: errors are logged without them.
 */

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : num(value));

function toRow(raw: Record<string, unknown>): CustomerRow {
  return {
    customer_key: String(raw.customer_key),
    phone: String(raw.phone ?? ""),
    customer_name: String(raw.customer_name ?? ""),
    orders_count: num(raw.orders_count),
    paid_count: num(raw.paid_count),
    total_paid: numOrNull(raw.total_paid),
    first_order_at: String(raw.first_order_at ?? ""),
    last_order_at: String(raw.last_order_at ?? ""),
    plan_ends: typeof raw.plan_ends === "string" ? raw.plan_ends : null,
    last_plan_end: typeof raw.last_plan_end === "string" ? raw.last_plan_end : null,
    state: isCustomerState(raw.state) ? raw.state : "none",
    is_new: raw.is_new === true,
    has_account: raw.has_account === true,
    source: typeof raw.source === "string" && raw.source ? raw.source : null,
  };
}

export type CustomersPage = {
  counts: CustomerCounts;
  rows: CustomerRow[];
  /** The page shown: the one asked for, or the last one when that was past the end. */
  page: number;
  pages: number;
};

/**
 * The chip counts and one page (1-based) of a filter in one call (public.customers_page: one aggregation, the page
 * clamped to the last one in the database). `search` is a customerSearchTerm() result, or null.
 */
export async function loadCustomersPage(
  supabase: SupabaseClient,
  filter: CustomerFilter,
  page: number,
  search: string | null,
): Promise<CustomersPage> {
  const { data, error } = await supabase.rpc("customers_page", {
    p_filter: filter,
    p_search: search,
    p_page: page,
    p_page_size: CUSTOMERS_PAGE_SIZE,
  });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as { counts?: Record<string, unknown>; rows?: unknown; page?: unknown; pages?: unknown };
  const counts = Object.fromEntries(CUSTOMER_FILTERS.map((key) => [key, num(raw.counts?.[key])])) as CustomerCounts;
  const rows = Array.isArray(raw.rows) ? (raw.rows as Record<string, unknown>[]).map(toRow) : [];
  const pages = Math.max(1, num(raw.pages));
  return { counts, rows, page: Math.min(Math.max(1, num(raw.page)), pages), pages };
}

/** The customer behind a key (the phone that order has now); null when no order has that id. */
export async function getCustomer(supabase: SupabaseClient, key: string): Promise<CustomerDetail | null> {
  const { data, error } = await supabase.rpc("customer_detail", { p_key: key });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!raw) return null;
  return {
    ...toRow(raw),
    last_address: String(raw.last_address ?? ""),
    last_window: String(raw.last_window ?? ""),
    note: String(raw.note ?? ""),
    note_updated_at: typeof raw.note_updated_at === "string" ? raw.note_updated_at : null,
    note_updated_by: typeof raw.note_updated_by === "string" && raw.note_updated_by ? raw.note_updated_by : null,
  };
}

/** The customer's orders, newest first. */
export async function listCustomerOrders(supabase: SupabaseClient, key: string): Promise<CustomerOrder[]> {
  const { data, error } = await supabase.rpc("customer_orders", { p_key: key });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CustomerOrder[]).map((order) => ({
    ...order,
    number: num(order.number),
    kcal: num(order.kcal),
    days: num(order.days),
    total: num(order.total),
  }));
}

/**
 * The overview's "ending soon" tile: public.customers_ending, the same is_ending rule as the Customers page's
 * "ending" chip, read only for the phones that can be ending. Owners and managers only, so the caller must not call
 * it for anyone else. Never throws; null when the read failed (a made-up 0 would look real).
 */
export async function loadEndingCustomers(
  supabase: SupabaseClient,
): Promise<{ count: number; next: string | null } | null> {
  try {
    const { data, error } = await supabase.rpc("customers_ending");
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    return { count: num(row?.ending_count), next: typeof row?.ending_next === "string" ? row.ending_next : null };
  } catch (error) {
    console.error("overview: ending customers read failed", error instanceof Error ? error.message : error);
    return null;
  }
}
