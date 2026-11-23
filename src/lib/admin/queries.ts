import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Dish, Duration, MenuItem, Program } from "@/lib/data/types";

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
