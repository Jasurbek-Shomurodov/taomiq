import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DEFAULT_CUTOFF_HOUR, DEFAULT_DELIVERY_WINDOWS } from "@/lib/order/rules";
import { DEMO_ANCHOR, demoDishes, demoDurations, demoMenu, demoPrograms } from "./demo";
import { cycleDayFor, type Dish, type Duration, type MenuEntry, type Program } from "./types";

/** Cache tag for everything the back office can change. */
export const CATALOG_TAG = "catalog";

/** True while the site shows demonstration data instead of the real database. */
export const isDemoCatalog = !isSupabaseConfigured;

export async function getPrograms(): Promise<Program[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  if (!isSupabaseConfigured) return demoPrograms;

  const { data, error } = await createPublicClient()
    .from("programs")
    .select("*, variants:program_variants(*)")
    .eq("active", true)
    .order("sort");
  if (error) throw new Error(`programs: ${error.message}`);

  return (data as Program[]).map((p) => ({
    ...p,
    variants: p.variants.filter((v) => v.active).sort((a, b) => a.sort - b.sort),
  }));
}

export async function getDurations(): Promise<Duration[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  if (!isSupabaseConfigured) return demoDurations;

  const { data, error } = await createPublicClient().from("durations").select("*").order("days");
  if (error) throw new Error(`durations: ${error.message}`);
  return data as Duration[];
}

export async function getMenuDay(variantId: string, cycleDay: number): Promise<MenuEntry[]> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  const order = ["breakfast", "snack1", "lunch", "snack2", "dinner"];
  let entries: MenuEntry[];

  if (!isSupabaseConfigured) {
    const dishes = new Map<string, Dish>(demoDishes.map((d) => [d.id, d]));
    entries = demoMenu
      .filter((m) => m.variant_id === variantId && m.cycle_day === cycleDay)
      .map((m) => ({ ...m, dish: dishes.get(m.dish_id)! }));
  } else {
    const { data, error } = await createPublicClient()
      .from("menu_items")
      .select("*, dish:dishes(*)")
      .eq("variant_id", variantId)
      .eq("cycle_day", cycleDay);
    if (error) throw new Error(`menu: ${error.message}`);
    entries = (data as MenuEntry[]).filter((m) => m.dish);
  }

  return entries.sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
}

/**
 * Whether a calorie level has at least one dish on any day of the cycle. The menu page shows its 30-day picker
 * only then; before the cook publishes the menu it shows one calm "published before launch" block instead.
 * Rows whose dish the public cannot read (inactive, archived) do not count, as getMenuDay leaves them out too.
 */
export async function hasMenu(variantId: string): Promise<boolean> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  if (!isSupabaseConfigured) return demoMenu.some((m) => m.variant_id === variantId);

  const { data, error } = await createPublicClient()
    .from("menu_items")
    .select("id, dish:dishes!inner(id)")
    .eq("variant_id", variantId)
    .limit(1);
  if (error) throw new Error(`menu check: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Whether any calorie level of these programs has a dish on the menu (the menu is published at all). */
export async function hasAnyMenu(programs: Pick<Program, "variants">[]): Promise<boolean> {
  const checks = await Promise.all(programs.flatMap((p) => p.variants.map((v) => hasMenu(v.id))));
  return checks.some(Boolean);
}

export type OrderSettings = {
  /** Two-hour delivery windows offered on the order form, e.g. "07:00–09:00". */
  deliveryWindows: string[];
  /** Orders placed before this Tashkent hour can start tomorrow. */
  cutoffHour: number;
};

/** Delivery windows and the order cutoff from the settings table. */
export async function getOrderSettings(): Promise<OrderSettings> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  const settings: OrderSettings = { deliveryWindows: DEFAULT_DELIVERY_WINDOWS, cutoffHour: DEFAULT_CUTOFF_HOUR };
  if (!isSupabaseConfigured) return settings;

  const { data, error } = await createPublicClient()
    .from("settings")
    .select("key, value")
    .in("key", ["delivery_windows", "order_cutoff_hour"]);
  if (error) throw new Error(`settings: ${error.message}`);

  for (const row of data ?? []) {
    if (
      row.key === "delivery_windows" &&
      Array.isArray(row.value) &&
      row.value.length > 0 &&
      row.value.every((w: unknown) => typeof w === "string")
    ) {
      settings.deliveryWindows = row.value;
    }
    if (row.key === "order_cutoff_hour") {
      const hour = Number(row.value);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 24) settings.cutoffHour = hour;
    }
  }
  return settings;
}

/** The cycle's anchor date (settings.cycle_anchor; the demo's anchor without a database). */
export async function getCycleAnchor(): Promise<string> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  if (!isSupabaseConfigured) return DEMO_ANCHOR;
  const { data } = await createPublicClient().from("settings").select("value").eq("key", "cycle_anchor").maybeSingle();
  return typeof data?.value === "string" ? data.value : DEMO_ANCHOR;
}

/**
 * Today's position in the 30-day cycle (Tashkent time), cached with the anchor: up to an hour late after midnight.
 * For static pages (the home preview). A page that renders per request uses currentCycleDay() instead.
 */
export async function getTodayCycleDay(): Promise<number> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  return cycleDayFor(new Date(), await getCycleAnchor());
}

/**
 * Today's position in the 30-day cycle, computed on each request from the cached anchor, so it turns over at
 * midnight in Tashkent. Only in per-request rendering (after a dynamic read such as searchParams).
 */
export async function currentCycleDay(): Promise<number> {
  return cycleDayFor(new Date(), await getCycleAnchor());
}
