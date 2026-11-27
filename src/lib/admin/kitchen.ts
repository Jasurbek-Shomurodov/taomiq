import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { htmlLang, type Locale } from "@/i18n/config";
import { exclusionTagsOf, normalizeTags, type AllergenKey } from "@/lib/allergens";
import { DEMO_ANCHOR } from "@/lib/data/demo";
import { localized } from "@/lib/data/localized";
import { SLOTS, cycleDayFor, type Dish, type MenuItem, type Program, type Slot } from "@/lib/data/types";
import { listPrograms } from "./queries";
import { addDays, tashkentDay } from "./stats";

/*
 * The kitchen's production sheet (docs/plans/kitchen-day-sheet.md, slice 1): what to cook on a date, from the orders
 * that deliver that day, the 30-day menu and the cycle anchor. Which orders deliver on a date is decided once, in
 * SQL (public.kitchen_orders, migration 0009); this file reads it and aggregates. buildProductionSheet() is a pure
 * function of its arguments, so it can be checked without a database.
 *
 * Orders reach the kitchen without any personal data: number, calorie level, status, day index, length, exclusions and
 * the allergens ticked at order (exclusion_tags, migration 0031, read through public.kitchen_orders_v2).
 */

// ---------- dates ----------

/** The sheet opens on tomorrow; these bound the date field (the order form takes starts up to 60 days ahead). */
export const SHEET_DAYS_BACK = 30;
export const SHEET_DAYS_AHEAD = 60;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written as "YYYY-MM-DD" (not 2026-02-30). */
export function isIsoDay(value: string): boolean {
  return ISO_DAY.test(value) && addDays(value, 0) === value;
}

export type SheetDate = {
  /** The day the sheet shows. */
  day: string;
  today: string;
  tomorrow: string;
  /** The allowed range, inclusive. */
  min: string;
  max: string;
  /** The neighbouring days, or null at the edge of the range. */
  prev: string | null;
  next: string | null;
};

/** The day of `?date=`: tomorrow (Tashkent) unless a valid day inside the range is asked for. */
export function sheetDate(param: string | undefined, now: Date): SheetDate {
  const today = tashkentDay(now)!;
  const tomorrow = addDays(today, 1);
  const min = addDays(today, -SHEET_DAYS_BACK);
  const max = addDays(today, SHEET_DAYS_AHEAD);
  // "YYYY-MM-DD" strings compare in calendar order.
  const day = param && isIsoDay(param) && param >= min && param <= max ? param : tomorrow;
  return {
    day,
    today,
    tomorrow,
    min,
    max,
    prev: day > min ? addDays(day, -1) : null,
    next: day < max ? addDays(day, 1) : null,
  };
}

/** Which day of the 30-day cycle a calendar day ("YYYY-MM-DD") is, counted from its start in Tashkent. */
export function cycleDayOn(day: string, anchorIso: string): number {
  return cycleDayFor(new Date(`${day}T00:00:00+05:00`), anchorIso);
}

// ---------- rows ----------

/** Firm orders are cooked for; confirmed ones are awaiting payment and only counted. */
export type KitchenStatus = "confirmed" | "paid" | "active";

/** One row of public.kitchen_orders_v2(date). No name, phone, address, comment or note. */
export type KitchenOrder = {
  number: number;
  variant_id: string;
  status: KitchenStatus;
  day_index: number;
  days: number;
  exclusions: string;
  /** The allergens ticked on the order form, in the list's order; [] for none (and before migration 0031). */
  exclusion_tags: AllergenKey[];
};

export function isFirm(status: string): boolean {
  return status === "paid" || status === "active";
}

/** The dish columns the sheet needs. */
export type SheetDish = Pick<Dish, "id" | "name_uz" | "name_ru" | "name_uzc" | "active" | "verified">;

export type SheetMenuItem = Pick<MenuItem, "variant_id" | "slot" | "dish_id" | "weight_g">;

/** A calorie level as the sheet names it: "BALANCE 1800". `order` is its place in the catalogue. */
export type SheetVariant = { id: string; programName: string; kcal: number; order: number };

/** Calorie levels in catalogue order (program sort, then variant sort), inactive ones included. */
export function sheetVariants(programs: readonly Program[]): SheetVariant[] {
  return programs.flatMap((p) => p.variants).map((v, order) => {
    const program = programs.find((p) => p.id === v.program_id);
    return { id: v.id, programName: program?.name ?? "", kcal: v.kcal, order };
  });
}

// ---------- aggregation ----------

/** One weight of one dish: `portions` portions of `weight_g` grams. */
export type SheetLine = { weight_g: number; portions: number; grams: number };

export type SheetDishRow = {
  dishId: string;
  /** In the staff member's language; null when the dish row is missing. */
  name: string | null;
  /** Lightest first. */
  lines: SheetLine[];
  portions: number;
  grams: number;
};

export type SheetSlot = { slot: Slot; dishes: SheetDishRow[]; portions: number; grams: number };

/** Rations of one level that leave out the same allergens: "of them 1 without milk". */
export type SheetTagGroup = { tags: AllergenKey[]; count: number };

export type SheetLevel = {
  variantId: string;
  /** "BALANCE 1800"; null when the level is not in the catalogue read. */
  label: string | null;
  /** Rations to cook (paid or active). */
  firm: number;
  /** The firm rations with allergens ticked at order, one group per set of allergens: largest first. */
  tagGroups: SheetTagGroup[];
  /** Confirmed, awaiting payment: not cooked. */
  awaiting: number;
  /** Whether the menu has any line for this level on the day. */
  hasMenu: boolean;
};

/**
 * One firm order with something to leave out: its allergens and the text, by exclusionTagsOf (src/lib/allergens.ts):
 * the text is the source of truth, so an edit by staff after the order wins over the tags stored at order. When the
 * text starts with the allergens in words ("Без: молоко. …", as the order form writes it), `text` is only what follows,
 * so the sheet does not say it twice; otherwise the whole text, as the customer or staff wrote it.
 */
export type SheetExclusion = { number: number; label: string | null; tags: AllergenKey[]; text: string };

/** The groups of a level's tagged rations: one per distinct set, the largest first, then in the list's order. */
function tagGroupsOf(sets: readonly AllergenKey[][]): SheetTagGroup[] {
  const byKey = new Map<string, SheetTagGroup>();
  for (const tags of sets) {
    if (tags.length === 0) continue;
    const key = tags.join(",");
    const group = byKey.get(key) ?? { tags, count: 0 };
    group.count += 1;
    byKey.set(key, group);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.tags.join(",").localeCompare(b.tags.join(",")));
}


/**
 * Something the cook must know before trusting the sheet. Shown, never hidden:
 * - `no-menu`: a level has rations to cook but no menu on this cycle day;
 * - `dish`: a dish being cooked is missing from the catalogue, hidden (inactive) or has no verified card.
 */
export type SheetProblem =
  | { kind: "no-menu"; variantId: string; label: string | null; rations: number }
  | { kind: "dish"; dishId: string; name: string | null; missing: boolean; hidden: boolean; unverified: boolean };

export type ProductionSheet = {
  /** Total rations to cook (firm orders). */
  firm: number;
  /** Confirmed orders awaiting payment, not in the totals. */
  awaiting: number;
  levels: SheetLevel[];
  /** Slots with something to cook, in SLOTS order. */
  slots: SheetSlot[];
  /** Firm orders with exclusions, by number. */
  exclusions: SheetExclusion[];
  problems: SheetProblem[];
};

const levelLabel = (variant: SheetVariant | undefined) =>
  variant ? `${variant.programName} ${variant.kcal}`.trim() : null;

/**
 * The production sheet: firm orders grouped by calorie level, each menu line of that level multiplied by its
 * count, merged by slot → dish → weight. Awaiting-payment orders are counted per level but never cooked.
 * Pure: `orders` are the rows that deliver on the day, `menuItems` that day's menu for every level.
 */
export function buildProductionSheet(
  orders: readonly KitchenOrder[],
  menuItems: readonly SheetMenuItem[],
  dishes: readonly SheetDish[],
  variants: readonly SheetVariant[],
  locale: Locale,
): ProductionSheet {
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const dishById = new Map(dishes.map((d) => [d.id, d]));
  const collator = new Intl.Collator(htmlLang[locale]);

  const firmBy = new Map<string, number>();
  const tagsBy = new Map<string, AllergenKey[][]>();
  const awaitingBy = new Map<string, number>();
  let firm = 0;
  let awaiting = 0;
  const exclusions: SheetExclusion[] = [];
  for (const order of orders) {
    if (isFirm(order.status)) {
      firm += 1;
      firmBy.set(order.variant_id, (firmBy.get(order.variant_id) ?? 0) + 1);
      const { tags, text } = exclusionTagsOf(order.exclusions ?? "", order.exclusion_tags ?? []);
      tagsBy.set(order.variant_id, [...(tagsBy.get(order.variant_id) ?? []), tags]);
      if (text || tags.length > 0) {
        exclusions.push({ number: order.number, label: levelLabel(variantById.get(order.variant_id)), tags, text });
      }
    } else if (order.status === "confirmed") {
      awaiting += 1;
      awaitingBy.set(order.variant_id, (awaitingBy.get(order.variant_id) ?? 0) + 1);
    }
  }
  exclusions.sort((a, b) => a.number - b.number);

  const menuVariants = new Set(menuItems.map((m) => m.variant_id));
  const placeOf = (id: string) => variantById.get(id)?.order ?? Number.MAX_SAFE_INTEGER;
  const levels: SheetLevel[] = [...new Set([...firmBy.keys(), ...awaitingBy.keys()])]
    .map((variantId) => ({
      variantId,
      label: levelLabel(variantById.get(variantId)),
      firm: firmBy.get(variantId) ?? 0,
      tagGroups: tagGroupsOf(tagsBy.get(variantId) ?? []),
      awaiting: awaitingBy.get(variantId) ?? 0,
      hasMenu: menuVariants.has(variantId),
    }))
    .sort((a, b) => placeOf(a.variantId) - placeOf(b.variantId) || a.variantId.localeCompare(b.variantId));

  // slot → dish → weight → portions
  const bySlot = new Map<Slot, Map<string, Map<number, number>>>();
  for (const item of menuItems) {
    const count = firmBy.get(item.variant_id) ?? 0;
    if (count === 0) continue;
    const byDish = bySlot.get(item.slot) ?? new Map<string, Map<number, number>>();
    const byWeight = byDish.get(item.dish_id) ?? new Map<number, number>();
    byWeight.set(item.weight_g, (byWeight.get(item.weight_g) ?? 0) + count);
    byDish.set(item.dish_id, byWeight);
    bySlot.set(item.slot, byDish);
  }

  const dishName = (dish: SheetDish | undefined) => (dish ? localized(dish, "name", locale) : null);

  const slots: SheetSlot[] = SLOTS.flatMap((slot) => {
    const byDish = bySlot.get(slot);
    if (!byDish) return [];
    const rows: SheetDishRow[] = [...byDish].map(([dishId, byWeight]) => {
      const lines = [...byWeight]
        .map(([weight_g, portions]) => ({ weight_g, portions, grams: weight_g * portions }))
        .sort((a, b) => a.weight_g - b.weight_g);
      return {
        dishId,
        name: dishName(dishById.get(dishId)),
        lines,
        portions: lines.reduce((sum, l) => sum + l.portions, 0),
        grams: lines.reduce((sum, l) => sum + l.grams, 0),
      };
    });
    rows.sort((a, b) => (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || collator.compare(a.name ?? "", b.name ?? ""));
    return [
      {
        slot,
        dishes: rows,
        portions: rows.reduce((sum, r) => sum + r.portions, 0),
        grams: rows.reduce((sum, r) => sum + r.grams, 0),
      },
    ];
  });

  const problems: SheetProblem[] = [];
  for (const level of levels) {
    if (level.firm > 0 && !level.hasMenu) {
      problems.push({ kind: "no-menu", variantId: level.variantId, label: level.label, rations: level.firm });
    }
  }
  const seen = new Set<string>();
  for (const slot of slots) {
    for (const row of slot.dishes) {
      if (seen.has(row.dishId)) continue;
      seen.add(row.dishId);
      const dish = dishById.get(row.dishId);
      const missing = !dish;
      const hidden = !!dish && !dish.active;
      const unverified = !!dish && !dish.verified;
      if (missing || hidden || unverified) {
        problems.push({ kind: "dish", dishId: row.dishId, name: row.name, missing, hidden, unverified });
      }
    }
  }

  return { firm, awaiting, levels, slots, exclusions, problems };
}

// ---------- loader ----------

export type ProductionDay = {
  /** Null when the read failed (each part fails on its own). */
  orders: KitchenOrder[] | null;
  /** Null when the cycle anchor could not be read. */
  cycleDay: number | null;
  /** That day's menu for every level; null when it (or the anchor before it) could not be read. */
  menu: SheetMenuItem[] | null;
  /** Dishes on that day's menu; null when the read failed. */
  dishes: SheetDish[] | null;
  /** Null when the catalogue could not be read. */
  variants: SheetVariant[] | null;
};

function logFailure(what: string, error: unknown) {
  console.error(`kitchen: ${what} failed`, error instanceof Error ? error.message : error);
}

async function readOrders(supabase: SupabaseClient, day: string): Promise<KitchenOrder[] | null> {
  try {
    let { data, error } = await supabase.rpc("kitchen_orders_v2", { p_date: day });
    // Before migration 0031 is applied there is only kitchen_orders (PostgREST: no such function): the same rows
    // without the tags. Remove once 0031 is in production.
    if (error?.code === "PGRST202") ({ data, error } = await supabase.rpc("kitchen_orders", { p_date: day }));
    if (error) throw new Error(error.message);
    return ((data ?? []) as (Omit<KitchenOrder, "exclusion_tags"> & { exclusion_tags?: unknown })[]).map((row) => ({
      ...row,
      number: Number(row.number),
      exclusions: row.exclusions ?? "",
      exclusion_tags: normalizeTags(Array.isArray(row.exclusion_tags) ? row.exclusion_tags : []),
    }));
  } catch (error) {
    logFailure("orders read", error);
    return null;
  }
}

async function readAnchor(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("settings").select("value").eq("key", "cycle_anchor").maybeSingle();
    if (error) throw new Error(error.message);
    // Same fallback as the public site (lib/data/catalog.ts), so the kitchen cooks the menu customers see.
    return typeof data?.value === "string" && isIsoDay(data.value) ? data.value : DEMO_ANCHOR;
  } catch (error) {
    logFailure("cycle anchor read", error);
    return null;
  }
}

async function readMenuDay(
  supabase: SupabaseClient,
  cycleDay: number,
): Promise<{ menu: SheetMenuItem[] | null; dishes: SheetDish[] | null }> {
  let menu: SheetMenuItem[];
  try {
    const { data, error } = await supabase
      .from("menu_items")
      .select("variant_id, slot, dish_id, weight_g")
      .eq("cycle_day", cycleDay);
    if (error) throw new Error(error.message);
    menu = (data ?? []) as SheetMenuItem[];
  } catch (error) {
    logFailure("menu read", error);
    return { menu: null, dishes: null };
  }

  const ids = [...new Set(menu.map((m) => m.dish_id))];
  if (ids.length === 0) return { menu, dishes: [] };
  try {
    const { data, error } = await supabase
      .from("dishes")
      .select("id, name_uz, name_ru, name_uzc, active, verified")
      .in("id", ids);
    if (error) throw new Error(error.message);
    return { menu, dishes: (data ?? []) as SheetDish[] };
  } catch (error) {
    logFailure("dishes read", error);
    return { menu, dishes: null };
  }
}

async function readVariants(supabase: SupabaseClient): Promise<SheetVariant[] | null> {
  try {
    return sheetVariants(await listPrograms(supabase));
  } catch (error) {
    logFailure("catalogue read", error);
    return null;
  }
}

/**
 * Everything the production sheet of one day needs, read through the signed-in staff member's session: the orders
 * through public.kitchen_orders (staff only, no personal data), the menu and the catalogue from the staff-readable
 * tables. Never throws; a failed part is null.
 */
export async function loadProductionDay(supabase: SupabaseClient, day: string): Promise<ProductionDay> {
  const menuPart = async () => {
    const anchor = await readAnchor(supabase);
    if (anchor === null) return { cycleDay: null, menu: null, dishes: null };
    const cycleDay = cycleDayOn(day, anchor);
    return { cycleDay, ...(await readMenuDay(supabase, cycleDay)) };
  };
  const [orders, menuDay, variants] = await Promise.all([readOrders(supabase, day), menuPart(), readVariants(supabase)]);
  return { orders, ...menuDay, variants };
}

// ---------- overview ----------

/** The overview's "tomorrow" tile: rations to cook on a day and the confirmed orders still awaiting payment. */
export type RationCount = { firm: number; awaiting: number };

/** Firm and awaiting-payment orders among the rows that deliver on a day (the same split as the sheet). Pure. */
export function countRations(orders: readonly Pick<KitchenOrder, "status">[]): RationCount {
  let firm = 0;
  let awaiting = 0;
  for (const order of orders) {
    if (isFirm(order.status)) firm += 1;
    else if (order.status === "confirmed") awaiting += 1;
  }
  return { firm, awaiting };
}

/** The ration count of one day through public.kitchen_orders (staff only). Never throws; null when the read failed. */
export async function loadRationCount(supabase: SupabaseClient, day: string): Promise<RationCount | null> {
  const orders = await readOrders(supabase, day);
  return orders === null ? null : countRations(orders);
}
