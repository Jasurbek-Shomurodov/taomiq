import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dish, Duration, MenuItem, Program } from "@/lib/data/types";
import {
  ORDER_EVENT_KINDS,
  ORDER_STATUSES,
  type Order,
  type OrderEvent,
  type OrderRow,
  type OrderStatus,
} from "./orders";

/** Programs with all calorie levels, including inactive ones. */
export async function listPrograms(supabase: SupabaseClient): Promise<Program[]> {
  const { data, error } = await supabase
    .from("programs")
    .select("*, variants:program_variants(*)")
    .order("sort");
  if (error) throw new Error(error.message);
  return (data as Program[]).map((p) => ({ ...p, variants: [...p.variants].sort((a, b) => a.sort - b.sort) }));
}

export async function listDishes(supabase: SupabaseClient): Promise<Dish[]> {
  const { data, error } = await supabase.from("dishes").select("*").order("name_ru");
  if (error) throw new Error(error.message);
  return data as Dish[];
}

export async function listDurations(supabase: SupabaseClient): Promise<Duration[]> {
  const { data, error } = await supabase.from("durations").select("*").order("days");
  if (error) throw new Error(error.message);
  return data as Duration[];
}

/** Every menu entry of one calorie level (at most 150 rows). */
export async function listMenu(supabase: SupabaseClient, variantId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase.from("menu_items").select("*").eq("variant_id", variantId);
  if (error) throw new Error(error.message);
  return data as MenuItem[];
}

/** How many menu entries each calorie level has, for the progress overview. */
export async function menuCounts(supabase: SupabaseClient): Promise<Map<string, { items: number; days: number }>> {
  const { data, error } = await supabase.from("menu_items").select("variant_id, cycle_day");
  if (error) throw new Error(error.message);
  const result = new Map<string, { items: number; days: Set<number> }>();
  for (const row of data as { variant_id: string; cycle_day: number }[]) {
    const entry = result.get(row.variant_id) ?? { items: 0, days: new Set<number>() };
    entry.items += 1;
    entry.days.add(row.cycle_day);
    result.set(row.variant_id, entry);
  }
  return new Map([...result].map(([id, v]) => [id, { items: v.items, days: v.days.size }]));
}

// ---------- orders (owners and managers; RLS returns nothing to other roles) ----------

export const ORDERS_PAGE_SIZE = 50;

const ORDER_LIST_COLUMNS =
  "id, number, status, program_name, kcal, days, weekdays_only, start_date, total, customer_name, phone, payment_method, created_by, created_at";

/**
 * One page of orders, newest first, optionally of one status and matching a search.
 * `search` is an or() filter from orderSearchFilter() (lib/admin/order-search.ts), never raw input.
 * No count here: the caller pages with orderCounts() (given the same search), and a range past the end simply
 * returns no rows (with count: "exact" PostgREST would answer 416 / PGRST103 instead).
 */
export async function listOrders(
  supabase: SupabaseClient,
  status: OrderStatus | null,
  page: number,
  search: string | null = null,
): Promise<OrderRow[]> {
  const from = (page - 1) * ORDERS_PAGE_SIZE;
  let query = supabase
    .from("orders")
    .select(ORDER_LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .range(from, from + ORDERS_PAGE_SIZE - 1);
  if (status) query = query.eq("status", status);
  if (search) query = query.or(search);
  const { data, error } = await query;
  if (error) {
    if (error.code === "PGRST103") return [];
    throw new Error(error.message);
  }
  return (data ?? []) as unknown as OrderRow[];
}

/**
 * How many orders are in each status (head-only count queries, no rows transferred). With `search` (an
 * orderSearchFilter() result) the counts are of the matching orders, so the tabs agree with the list.
 */
export async function orderCounts(
  supabase: SupabaseClient,
  search: string | null = null,
): Promise<Record<OrderStatus, number>> {
  const results = await Promise.all(
    ORDER_STATUSES.map((status) => {
      const query = supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", status);
      return search ? query.or(search) : query;
    }),
  );
  const counts = {} as Record<OrderStatus, number>;
  ORDER_STATUSES.forEach((status, i) => {
    const { error, count } = results[i];
    if (error) throw new Error(error.message);
    counts[status] = count ?? 0;
  });
  return counts;
}

/** Orders waiting for a call, for the overview card. */
export async function newOrderCount(supabase: SupabaseClient): Promise<number> {
  const { error, count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Everything except ip_hash, which is only for rate limiting. */
const ORDER_DETAIL_COLUMNS =
  "id, number, status, variant_id, program_name, kcal, days, weekdays_only, start_date, price_per_day, total, customer_name, phone, address, delivery_window, comment, exclusions, locale, source, staff_note, payment_method, cancel_reason, created_by, user_id, consent_at, created_at, updated_at";

export async function getOrder(supabase: SupabaseClient, id: string): Promise<Order | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as Order | null;
}

/** How many history rows the order page shows (newest first); an order collects a handful, so this is a guard. */
export const ORDER_EVENTS_LIMIT = 200;

/**
 * An order's history (public.order_events, migration 0018), newest first. Owners and managers only (RLS). Rows of an
 * unknown kind (a later migration) are left out rather than shown wrong.
 */
export async function listOrderEvents(supabase: SupabaseClient, orderId: string): Promise<OrderEvent[]> {
  const { data, error } = await supabase
    .from("order_events")
    .select("id, at, actor, actor_name, kind, from_status, to_status, detail")
    .eq("order_id", orderId)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ORDER_EVENTS_LIMIT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as OrderEvent[]).filter((event) =>
    (ORDER_EVENT_KINDS as readonly string[]).includes(event.kind),
  );
}
