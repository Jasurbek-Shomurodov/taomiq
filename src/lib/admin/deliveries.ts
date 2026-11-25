import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { htmlLang, type Locale } from "@/i18n/config";
import { DEFAULT_DELIVERY_WINDOWS } from "@/lib/order/rules";
import { isFirm, type KitchenStatus } from "./kitchen";

/*
 * The delivery sheet (docs/plans/kitchen-day-sheet.md, slice 2): who gets a ration on a date, where and in
 * which window. Which orders deliver on a date is decided once, in SQL (public.delivery_orders, migration 0010, the
 * same rule as the kitchen's sheet); this file reads it and groups. buildDeliverySheet() is a pure function of its
 * arguments, so it can be checked without a database.
 *
 * The rows carry personal data (name, phone, address, comment): the function returns them to owners and managers
 * only (private.can_handle_orders(), migration 0011).
 */

// ---------- rows ----------

/** One row of public.delivery_orders(date). */
export type DeliveryOrder = {
  id: string;
  number: number;
  status: KitchenStatus;
  program_name: string;
  kcal: number;
  variant_id: string;
  day_index: number;
  days: number;
  customer_name: string;
  phone: string;
  address: string;
  delivery_window: string;
  comment: string;
  exclusions: string;
  staff_note: string;
};

export type DeliveryRow = DeliveryOrder & { firstDay: boolean; lastDay: boolean };

export type DeliveryGroup = {
  window: string;
  /** False for a window that is not (or no longer) in the delivery_windows setting: listed after the known ones. */
  known: boolean;
  /** By address, then number. */
  rows: DeliveryRow[];
};

export type DeliverySheet = {
  /** Paid or active: delivered. */
  firm: number;
  /** Confirmed, awaiting payment: listed apart, not delivered until paid. */
  awaiting: number;
  /** Firm deliveries on the order's first and last day. */
  firstDays: number;
  lastDays: number;
  /** Firm deliveries by window, in the order of the setting, unknown windows last. */
  groups: DeliveryGroup[];
  /** Awaiting-payment orders, in the same order (window, address). */
  awaitingRows: DeliveryRow[];
};

/**
 * The delivery sheet: firm orders grouped by window (the setting's order, then any other window alphabetically),
 * each group sorted by address. Pure: `orders` are the rows that deliver on the day, `windows` the setting.
 */
export function buildDeliverySheet(
  orders: readonly DeliveryOrder[],
  windows: readonly string[],
  locale: Locale,
): DeliverySheet {
  // The collator can call two different strings equal ("09:00" and "9:00" with numeric: true), so the exact string
  // breaks the tie: the rows of one window always stay together and each group is one window.
  const collator = new Intl.Collator(htmlLang[locale], { numeric: true });
  const place = new Map(windows.map((w, i) => [w, i]));
  const placeOf = (window: string) => place.get(window) ?? Number.MAX_SAFE_INTEGER;
  const byWindowThenAddress = (a: DeliveryRow, b: DeliveryRow) =>
    placeOf(a.delivery_window) - placeOf(b.delivery_window) ||
    collator.compare(a.delivery_window, b.delivery_window) ||
    (a.delivery_window < b.delivery_window ? -1 : a.delivery_window > b.delivery_window ? 1 : 0) ||
    collator.compare(a.address, b.address) ||
    a.number - b.number;

  const firmRows: DeliveryRow[] = [];
  const awaitingRows: DeliveryRow[] = [];
  for (const order of orders) {
    const row: DeliveryRow = { ...order, firstDay: order.day_index === 1, lastDay: order.day_index === order.days };
    if (isFirm(order.status)) firmRows.push(row);
    else if (order.status === "confirmed") awaitingRows.push(row);
  }
  firmRows.sort(byWindowThenAddress);
  awaitingRows.sort(byWindowThenAddress);

  const groups: DeliveryGroup[] = [];
  for (const row of firmRows) {
    const last = groups.at(-1);
    if (last && last.window === row.delivery_window) last.rows.push(row);
    else groups.push({ window: row.delivery_window, known: place.has(row.delivery_window), rows: [row] });
  }

  return {
    firm: firmRows.length,
    awaiting: awaitingRows.length,
    firstDays: firmRows.filter((r) => r.firstDay).length,
    lastDays: firmRows.filter((r) => r.lastDay).length,
    groups,
    awaitingRows,
  };
}

/** A phone number for a tel: link: digits and the leading plus only. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

// ---------- loader ----------

export type DeliveryDay = {
  /** Null when the read failed. */
  orders: DeliveryOrder[] | null;
  /** The delivery_windows setting (the default list when it is not set); null when the read failed. */
  windows: string[] | null;
};

function logFailure(what: string, error: unknown) {
  console.error(`deliveries: ${what} failed`, error instanceof Error ? error.message : error);
}

async function readOrders(supabase: SupabaseClient, day: string): Promise<DeliveryOrder[] | null> {
  try {
    const { data, error } = await supabase.rpc("delivery_orders", { p_date: day });
    if (error) throw new Error(error.message);
    return ((data ?? []) as DeliveryOrder[]).map((row) => ({
      ...row,
      number: Number(row.number),
      comment: row.comment ?? "",
      exclusions: row.exclusions ?? "",
      staff_note: row.staff_note ?? "",
    }));
  } catch (error) {
    logFailure("orders read", error);
    return null;
  }
}

async function readWindows(supabase: SupabaseClient): Promise<string[] | null> {
  try {
    const { data, error } = await supabase.from("settings").select("value").eq("key", "delivery_windows").maybeSingle();
    if (error) throw new Error(error.message);
    const value: unknown = data?.value;
    // Same fallback as the order form (lib/data/catalog.ts).
    return Array.isArray(value) && value.length > 0 && value.every((w) => typeof w === "string")
      ? (value as string[])
      : DEFAULT_DELIVERY_WINDOWS;
  } catch (error) {
    logFailure("delivery windows read", error);
    return null;
  }
}

/**
 * Everything the delivery sheet of one day needs, read through the signed-in session: the orders through
 * public.delivery_orders (owners and managers), the window order from settings. Never throws; a failed part is null.
 */
export async function loadDeliveryDay(supabase: SupabaseClient, day: string): Promise<DeliveryDay> {
  const [orders, windows] = await Promise.all([readOrders(supabase, day), readWindows(supabase)]);
  return { orders, windows };
}
