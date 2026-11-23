import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
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

/** Today's position in the 30-day cycle (Tashkent time). Refreshes hourly. */
export async function getTodayCycleDay(): Promise<number> {
  "use cache";
  cacheTag(CATALOG_TAG);
  cacheLife("hours");

  let anchor = DEMO_ANCHOR;
  if (isSupabaseConfigured) {
    const { data } = await createPublicClient()
      .from("settings")
      .select("value")
      .eq("key", "cycle_anchor")
      .maybeSingle();
    if (typeof data?.value === "string") anchor = data.value;
  }
  return cycleDayFor(new Date(), anchor);
}
