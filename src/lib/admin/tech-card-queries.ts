import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIngredientUnit, type IngredientUnit } from "./ingredients";
import { parseDbQuantity } from "./purchases";
import {
  isCostState,
  isRecipeState,
  isTechUnit,
  type CostPreview,
  type CostProblem,
  type DishCost,
  type IngredientUsage,
  type Names,
  type RationLevel,
  type Recipe,
  type RecipeOverview,
  type ShoppingList,
  type TechLinePayload,
  type UncountedDish,
} from "./tech-cards";

/*
 * Reads of the tech cards of migration 0023, through the signed-in session. Each throws on a failed read; the pages turn
 * that into a notice. Which reads carry money and who may call them is decided by the database functions:
 *   every staff member  tech_card_overview, tech_card_recipes, shopping_list (quantities only)
 *   owners and managers dish_costs, tech_card_cost_preview, shopping_list_costed, ingredient_usage
 *   the owner           ration_costs
 */

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): Record<string, unknown>[] =>
  (Array.isArray(value) ? value : []).filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
const unitOf = (value: unknown): IngredientUnit => (isIngredientUnit(value) ? value : "pcs");

/** A quantity in thousandths; 0 for one that does not parse. */
const milli = (value: unknown): number => parseDbQuantity(value) ?? 0;

/** A signed quantity ("-0.180") in thousandths. */
function signedMilli(value: unknown): number {
  const text = typeof value === "number" ? String(value) : str(value).trim();
  if (text.startsWith("-")) return -milli(text.slice(1));
  return milli(text);
}

function names(raw: Record<string, unknown>, prefix = "name"): Names {
  return { name_ru: str(raw[`${prefix}_ru`]), name_uz: str(raw[`${prefix}_uz`]), name_uzc: str(raw[`${prefix}_uzc`]) };
}

/** Every dish that has a card, by dish id: whether it has a recipe (no money). */
export async function loadRecipeOverview(supabase: SupabaseClient): Promise<Map<string, RecipeOverview>> {
  const { data, error } = await supabase.rpc("tech_card_overview");
  if (error) throw new Error(`tech_card_overview: ${error.code} ${error.message}`);
  const map = new Map<string, RecipeOverview>();
  for (const row of list(data)) {
    map.set(String(row.dish_id), {
      state: isRecipeState(row.state) ? row.state : "none",
      lines: num(row.lines),
      batchOutputG: numOrNull(row.batch_output_g),
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    });
  }
  return map;
}

/** Owners and managers: every dish's card state and cost, by dish id. */
export async function loadDishCosts(supabase: SupabaseClient): Promise<Map<string, DishCost>> {
  const { data, error } = await supabase.rpc("dish_costs");
  if (error) throw new Error(`dish_costs: ${error.code} ${error.message}`);
  const map = new Map<string, DishCost>();
  for (const row of list(data)) {
    map.set(String(row.dish_id), {
      state: isCostState(row.state) ? row.state : "none",
      lines: num(row.lines),
      batchOutputG: numOrNull(row.batch_output_g),
      batchCost: numOrNull(row.batch_cost),
      cost100: numOrNull(row.cost_100),
      costPortion: numOrNull(row.cost_portion),
      missingPrices: num(row.missing_prices),
      badUnits: num(row.bad_units),
    });
  }
  return map;
}

/** The recipes of the given dishes (at most 300), by dish id. A dish without a card is not in the map. */
export async function loadRecipes(supabase: SupabaseClient, dishIds: readonly string[]): Promise<Map<string, Recipe>> {
  const ids = [...new Set(dishIds)].slice(0, 300);
  const map = new Map<string, Recipe>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase.rpc("tech_card_recipes", { p_dish_ids: ids });
  if (error) throw new Error(`tech_card_recipes: ${error.code} ${error.message}`);
  for (const row of list(data)) {
    map.set(String(row.dish_id), {
      dishId: String(row.dish_id),
      batchOutputG: num(row.batch_output_g),
      method: str(row.method),
      notes: str(row.notes),
      updatedAt: str(row.updated_at),
      updatedByName: str(row.updated_by_name),
      lines: list(row.lines)
        .slice()
        .sort((a, b) => num(a.sort) - num(b.sort))
        .map((line) => ({
          ingredientId: String(line.ingredient_id),
          ...names(line),
          ingredientUnit: unitOf(line.ingredient_unit),
          milli: milli(line.quantity),
          unit: isTechUnit(line.unit) ? line.unit : "g",
          unitOk: line.unit_ok === true,
        })),
    });
  }
  return map;
}

const COST_PROBLEMS: readonly CostProblem[] = ["ingredient", "quantity", "unit", "price"];

/** Owners and managers: the cost of a recipe as it is being edited (public.tech_card_cost_preview). */
export async function loadCostPreview(
  supabase: SupabaseClient,
  input: { batchOutputG: number | null; portionG: number; lines: readonly TechLinePayload[] },
): Promise<CostPreview> {
  const { data, error } = await supabase.rpc("tech_card_cost_preview", {
    p_batch_output_g: input.batchOutputG,
    p_portion_g: input.portionG,
    p_lines: input.lines,
  });
  if (error) throw new Error(`tech_card_cost_preview: ${error.code} ${error.message}`);
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    lines: list(raw.lines).map((line) => ({
      cost: numOrNull(line.cost),
      problem: COST_PROBLEMS.includes(line.problem as CostProblem) ? (line.problem as CostProblem) : null,
    })),
    batchCost: numOrNull(raw.batch_cost),
    cost100: numOrNull(raw.cost_100),
    costPortion: numOrNull(raw.cost_portion),
    complete: raw.complete === true,
  };
}

function uncounted(value: unknown): UncountedDish[] {
  return list(value).map((row) => ({
    dishId: String(row.dish_id),
    ...names(row),
    state: row.state === "empty" || row.state === "unit" ? row.state : "none",
    portions: num(row.portions),
    grams: num(row.grams),
  }));
}

/**
 * The shopping list for `days` days from `from` (1–7). `costed` (owners and managers only: shopping_list_costed) adds
 * the usual price and amount per line; otherwise there is no money in it at all.
 */
export async function loadShoppingList(
  supabase: SupabaseClient,
  from: string,
  days: number,
  costed: boolean,
): Promise<ShoppingList> {
  const fn = costed ? "shopping_list_costed" : "shopping_list";
  const { data, error } = await supabase.rpc(fn, { p_from: from, p_days: days });
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    from: str(raw.from),
    to: str(raw.to),
    days: num(raw.days),
    rations: num(raw.rations),
    noMenuRations: num(raw.no_menu_rations),
    dishes: num(raw.dishes),
    countedDishes: num(raw.counted_dishes),
    lines: list(raw.lines).map((row) => ({
      ingredientId: String(row.ingredient_id),
      ...names(row),
      categoryId: String(row.category_id),
      category: names(row, "category"),
      unit: unitOf(row.unit),
      milli: milli(row.quantity),
      usualPrice: costed ? numOrNull(row.usual_price) : null,
      amount: costed ? numOrNull(row.amount) : null,
    })),
    uncounted: uncounted(raw.uncounted),
    totalAmount: costed ? numOrNull(raw.total_amount) : null,
    unpriced: costed ? numOrNull(raw.unpriced) : null,
  };
}

/** Owners and managers: purchases against theoretical use over a period (public.ingredient_usage). */
export async function loadIngredientUsage(
  supabase: SupabaseClient,
  period: { from: string; to: string },
): Promise<IngredientUsage> {
  const { data, error } = await supabase.rpc("ingredient_usage", { p_from: period.from, p_to: period.to });
  if (error) throw new Error(`ingredient_usage: ${error.code} ${error.message}`);
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    from: str(raw.from),
    to: str(raw.to),
    usedTo: typeof raw.used_to === "string" ? raw.used_to : null,
    rations: num(raw.rations),
    noMenuRations: num(raw.no_menu_rations),
    dishes: num(raw.dishes),
    countedDishes: num(raw.counted_dishes),
    uncounted: uncounted(raw.uncounted),
    rows: list(raw.rows).map((row) => ({
      ingredientId: String(row.ingredient_id),
      ...names(row),
      categoryId: String(row.category_id),
      unit: unitOf(row.unit),
      usualPrice: numOrNull(row.usual_price),
      boughtMilli: milli(row.bought),
      boughtAmount: num(row.bought_amount),
      otherUnits: row.other_units === true,
      usedMilli: milli(row.used),
      diffMilli: signedMilli(row.diff),
    })),
  };
}

/** The owner: what a ration costs against its price, per calorie level and cycle day (public.ration_costs). */
export async function loadRationCosts(supabase: SupabaseClient): Promise<RationLevel[]> {
  const { data, error } = await supabase.rpc("ration_costs", { p_cycle_day: null });
  if (error) throw new Error(`ration_costs: ${error.code} ${error.message}`);
  const raw = (data ?? {}) as Record<string, unknown>;
  return list(raw.levels).map((row) => ({
    variantId: String(row.variant_id),
    programName: str(row.program_name),
    kcal: num(row.kcal),
    pricePerDay: num(row.price_per_day),
    mealsPerDay: num(row.meals_per_day),
    active: row.active === true,
    daysWithMenu: num(row.days_with_menu),
    daysComplete: num(row.days_complete),
    daysNotFull: num(row.days_not_full),
    daysNoCost: num(row.days_no_cost),
    avgCost: numOrNull(row.avg_cost),
    avgMargin: numOrNull(row.avg_margin),
    avgMarginPct: numOrNull(row.avg_margin_pct),
    days: list(row.days).map((day) => ({
      cycleDay: num(day.cycle_day),
      items: num(day.items),
      missing: num(day.missing),
      full: day.full === true,
      cost: numOrNull(day.cost),
      margin: numOrNull(day.margin),
      marginPct: numOrNull(day.margin_pct),
    })),
  }));
}
