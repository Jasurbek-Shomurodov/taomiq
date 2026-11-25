import type { IngredientUnit } from "./ingredients";
import { PURCHASE_LIMITS, parseQuantity, quantityText } from "./purchases";

/*
 * Tech cards (docs/plans/zarkebab-feature-port.md, slice 7; migration 0023, public.tech_cards and
 * public.tech_card_lines). Pure and not server-only: the editor (a client component) checks a recipe with these rules,
 * the action checks again, and public.tech_card_save is the authority. The cost rule is not here: it lives once, in
 * SQL (private.line_cost and friends); the screens only show the figures the database returns.
 *
 * A recipe is the quantities for one batch and the cooked weight that batch yields (batch output, grams). Quantities
 * are held as integer thousandths ("milli"), as for purchases.
 */

/** The units a recipe line is written in. The table's unit check holds the same list. */
export const TECH_UNITS = ["g", "ml", "pcs"] as const;
export type TechUnit = (typeof TECH_UNITS)[number];

export function isTechUnit(value: unknown): value is TechUnit {
  return typeof value === "string" && (TECH_UNITS as readonly string[]).includes(value);
}

/**
 * The line unit for an ingredient's purchase unit (private.line_unit_fits, 0023): grams of what is bought by the
 * kilogram, millilitres of what is bought by the litre, pieces of what is bought by the piece or the pack.
 */
export const TECH_UNIT_FOR: Record<IngredientUnit, TechUnit> = { kg: "g", l: "ml", pcs: "pcs", pack: "pcs" };

export const TECH_CARD_LIMITS = {
  lines: 100,
  methodMax: 4000,
  notesMax: 2000,
  batchMax: 1_000_000,
  quantityMaxMilli: PURCHASE_LIMITS.quantityMaxMilli,
} as const;

/**
 * A card's state as owners and managers see it (public.dish_costs): no card, a card without lines, a line whose unit
 * no longer fits its ingredient (or a pack without its pieces), an ingredient without a usual price, or a known cost.
 */
export const COST_STATES = ["none", "empty", "unit", "price", "ok"] as const;
export type CostState = (typeof COST_STATES)[number];

export function isCostState(value: unknown): value is CostState {
  return typeof value === "string" && (COST_STATES as readonly string[]).includes(value);
}

/** A card's state as every staff member sees it (public.tech_card_overview): no money, only whether a recipe exists. */
export const RECIPE_STATES = ["none", "empty", "ready"] as const;
export type RecipeState = (typeof RECIPE_STATES)[number];

export function isRecipeState(value: unknown): value is RecipeState {
  return typeof value === "string" && (RECIPE_STATES as readonly string[]).includes(value);
}

/** The list's filter (?status= on /tech-cards). No key is "all". */
export const TECH_CARD_FILTERS = ["ready", "incomplete"] as const;
export type TechCardFilter = (typeof TECH_CARD_FILTERS)[number];

export function isTechCardFilter(value: unknown): value is TechCardFilter {
  return typeof value === "string" && (TECH_CARD_FILTERS as readonly string[]).includes(value);
}

/** Ready: for owners and managers a card with a known cost; for the kitchen a card with a recipe. */
export function isCardReady(state: CostState | RecipeState): boolean {
  return state === "ok" || state === "ready";
}

/** A whole number of grams typed with spaces ("1 200"), or null. */
export function parseBatch(raw: string): number | null {
  const value = raw.replace(/[\s  ]/g, "");
  if (!/^\d{1,7}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= TECH_CARD_LIMITS.batchMax ? n : null;
}

// ---------- the editor ----------

/** One line as the editor holds it: the picked ingredient and the quantity as typed. */
export type TechLineDraft = { ingredientId: string; quantity: string };

export type TechLineProblem = "ingredient" | "quantity" | "duplicate";
export type TechFormProblem = "batch" | "lines" | "method" | "notes";
export type TechCardErrors = { form: TechFormProblem[]; lines: Record<number, TechLineProblem[]> };

/** A line as sent to public.tech_card_save. */
export type TechLinePayload = { ingredient_id: string; quantity: string; unit: TechUnit };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Length as Postgres char_length counts it: code points. */
const length = (value: string) => [...value].length;

/**
 * Checks a recipe. `unitOf` gives an ingredient's purchase unit (null when it is not in the catalogue read); the line
 * unit follows from it. Lines with nothing picked and nothing typed are ignored (the empty last row).
 */
export function checkTechCard(
  input: { batch: string; method: string; notes: string; lines: readonly TechLineDraft[] },
  unitOf: (ingredientId: string) => IngredientUnit | null,
): { errors: TechCardErrors; payload: TechLinePayload[]; batch: number | null } {
  const errors: TechCardErrors = { form: [], lines: {} };
  const batch = parseBatch(input.batch);
  if (batch === null) errors.form.push("batch");
  if (length(input.method.trim()) > TECH_CARD_LIMITS.methodMax) errors.form.push("method");
  if (length(input.notes.trim()) > TECH_CARD_LIMITS.notesMax) errors.form.push("notes");

  const payload: TechLinePayload[] = [];
  const seen = new Set<string>();
  input.lines.forEach((line, index) => {
    if (!line.ingredientId && !line.quantity.trim()) return;
    const problems: TechLineProblem[] = [];
    const unit = UUID_RE.test(line.ingredientId) ? unitOf(line.ingredientId) : null;
    if (unit === null) problems.push("ingredient");
    else if (seen.has(line.ingredientId)) problems.push("duplicate");
    const milli = parseQuantity(line.quantity);
    if (milli === null) problems.push("quantity");
    if (problems.length) {
      errors.lines[index] = problems;
      return;
    }
    seen.add(line.ingredientId);
    payload.push({ ingredient_id: line.ingredientId, quantity: quantityText(milli!), unit: TECH_UNIT_FOR[unit!] });
  });

  if (payload.length === 0 && Object.keys(errors.lines).length === 0) errors.form.push("lines");
  if (payload.length > TECH_CARD_LIMITS.lines) errors.form.push("lines");
  return { errors, payload, batch };
}

export function hasTechCardErrors(errors: TechCardErrors): boolean {
  return errors.form.length > 0 || Object.keys(errors.lines).length > 0;
}

/** The lines the editor sends (a JSON field), read defensively; null when it is not an array of lines. */
export function readTechLinesField(raw: string): TechLineDraft[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > TECH_CARD_LIMITS.lines * 2) return null;
  const lines: TechLineDraft[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    lines.push({
      ingredientId: typeof row.ingredient_id === "string" ? row.ingredient_id : "",
      quantity: typeof row.quantity === "string" || typeof row.quantity === "number" ? String(row.quantity) : "",
    });
  }
  return lines;
}

/** "12,5" for a stored quantity, as a person would type it. */
export function quantityInput(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole},${fraction}` : String(whole);
}

/**
 * A saved line as the editor starts it. A line whose unit no longer fits its ingredient (the ingredient's purchase
 * unit changed since) starts with no quantity and keeps what it was (`was`), so nobody reads 200 g as 200 pieces.
 */
export function draftFromLine(
  line: { ingredientId: string; milli: number; unit: TechUnit },
  unitOf: (ingredientId: string) => IngredientUnit | null,
): TechLineDraft & { was: { milli: number; unit: TechUnit } | null } {
  const unit = unitOf(line.ingredientId);
  const fits = unit !== null && TECH_UNIT_FOR[unit] === line.unit;
  return fits
    ? { ingredientId: line.ingredientId, quantity: quantityInput(line.milli), was: null }
    : { ingredientId: line.ingredientId, quantity: "", was: { milli: line.milli, unit: line.unit } };
}

/**
 * The lines the live cost is asked for: those with an ingredient in the catalogue and a valid quantity, in order, with
 * their position among `lines`. The server page and the editor build it the same way, so the editor knows whether the
 * cost it was given is still that of what it shows.
 */
export function previewPayload(
  lines: readonly TechLineDraft[],
  unitOf: (ingredientId: string) => IngredientUnit | null,
): { index: number; line: TechLinePayload }[] {
  return lines.flatMap((line, index) => {
    const unit = UUID_RE.test(line.ingredientId) ? unitOf(line.ingredientId) : null;
    const milli = parseQuantity(line.quantity);
    if (unit === null || milli === null) return [];
    return [{ index, line: { ingredient_id: line.ingredientId, quantity: quantityText(milli), unit: TECH_UNIT_FOR[unit] } }];
  });
}

/** The key of a live-cost request: the batch output and the lines, as sent. */
export function previewKey(batch: number | null, payload: readonly { line: TechLinePayload }[]): string {
  return JSON.stringify([batch, payload.map((p) => [p.line.ingredient_id, p.line.quantity, p.line.unit])]);
}

// ---------- shapes read from the database ----------

/** Names in three languages, as the functions return them. */
export type Names = { name_ru: string; name_uz: string; name_uzc: string };

export type RecipeLine = Names & {
  ingredientId: string;
  ingredientUnit: IngredientUnit;
  milli: number;
  unit: TechUnit;
  /** False when the line can no longer be converted to the ingredient's unit (its unit changed, a pack lost its count). */
  unitOk: boolean;
};

export type Recipe = {
  dishId: string;
  batchOutputG: number;
  method: string;
  notes: string;
  updatedAt: string;
  updatedByName: string;
  lines: RecipeLine[];
};

/** Overview row for every staff member: no money. */
export type RecipeOverview = { state: RecipeState; lines: number; batchOutputG: number | null; updatedAt: string | null };

/** Owners and managers: a dish's card state and its cost, whole UZS; the costs are null unless the state is "ok". */
export type DishCost = {
  state: CostState;
  lines: number;
  batchOutputG: number | null;
  batchCost: number | null;
  cost100: number | null;
  costPortion: number | null;
  missingPrices: number;
  badUnits: number;
};

export type CostProblem = "ingredient" | "quantity" | "unit" | "price";

/** public.tech_card_cost_preview: the cost of a recipe being edited, per line and in total. */
export type CostPreview = {
  lines: { cost: number | null; problem: CostProblem | null }[];
  batchCost: number | null;
  cost100: number | null;
  costPortion: number | null;
  complete: boolean;
};

/** A dish that a shopping list or the usage estimate could not count: no card, a card without lines, a unit problem. */
export type UncountedDish = Names & { dishId: string; state: "none" | "empty" | "unit"; portions: number; grams: number };

export type ShoppingLine = Names & {
  ingredientId: string;
  categoryId: string;
  category: Names;
  unit: IngredientUnit;
  milli: number;
  /** Only in the costed list. */
  usualPrice: number | null;
  amount: number | null;
};

export type ShoppingList = {
  from: string;
  to: string;
  days: number;
  rations: number;
  noMenuRations: number;
  dishes: number;
  countedDishes: number;
  lines: ShoppingLine[];
  uncounted: UncountedDish[];
  /** Only in the costed list: Σ amounts of the priced lines, and how many lines have no price. */
  totalAmount: number | null;
  unpriced: number | null;
};

export type UsageRow = Names & {
  ingredientId: string;
  categoryId: string;
  unit: IngredientUnit;
  usualPrice: number | null;
  boughtMilli: number;
  boughtAmount: number;
  otherUnits: boolean;
  usedMilli: number;
  /** Bought − used, thousandths; negative when the cards say more was used than bought. */
  diffMilli: number;
};

export type IngredientUsage = {
  from: string;
  to: string;
  /** The last day counted for use (the period's end or today); null when the whole period is in the future. */
  usedTo: string | null;
  rations: number;
  noMenuRations: number;
  dishes: number;
  countedDishes: number;
  uncounted: UncountedDish[];
  rows: UsageRow[];
};

export type RationDay = {
  cycleDay: number;
  items: number;
  missing: number;
  /** The menu has at least meals-per-day dishes (the menu editor's "complete"). */
  full: boolean;
  /** Null unless the day is full and every dish has a known cost. */
  cost: number | null;
  margin: number | null;
  marginPct: number | null;
};

export type RationLevel = {
  variantId: string;
  programName: string;
  kcal: number;
  pricePerDay: number;
  mealsPerDay: number;
  active: boolean;
  daysWithMenu: number;
  daysComplete: number;
  /** Days of the cycle whose menu is empty or not full: not counted. */
  daysNotFull: number;
  /** Full days with a dish of unknown cost: not counted. */
  daysNoCost: number;
  avgCost: number | null;
  avgMargin: number | null;
  avgMarginPct: number | null;
  days: RationDay[];
};

/** Overruns: levels whose average cost, or days whose cost, is above the price per day. Pure. */
export function rationOverruns(levels: readonly RationLevel[]): {
  levels: RationLevel[];
  days: { level: RationLevel; day: RationDay }[];
} {
  return {
    levels: levels.filter((level) => level.avgCost !== null && level.avgCost > level.pricePerDay),
    days: levels.flatMap((level) =>
      level.days.filter((day) => day.cost !== null && day.cost > level.pricePerDay).map((day) => ({ level, day })),
    ),
  };
}

/** Thousandths, signed: the absolute value as formatQuantity takes it, with the sign apart. */
export function signedMilli(milli: number): { sign: "" | "+" | "−"; abs: number } {
  if (milli === 0) return { sign: "", abs: 0 };
  return { sign: milli > 0 ? "+" : "−", abs: Math.abs(milli) };
}
