import { FINANCE_LIMITS } from "./finance/categories";

/*
 * The ingredient catalogue (docs/plans/zarkebab-feature-port.md, slice 6; migration 0022, public.ingredients and
 * public.ingredient_categories). Pure and not server-only: the editor and the purchase form (client components) check
 * with these rules, the actions check again, and the table's checks are the authority. Keep the limits in step with
 * the migration.
 */

/** How an ingredient is bought and priced. The table's unit check holds the same list. */
export const INGREDIENT_UNITS = ["kg", "l", "pcs", "pack"] as const;
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];

export function isIngredientUnit(value: unknown): value is IngredientUnit {
  return typeof value === "string" && (INGREDIENT_UNITS as readonly string[]).includes(value);
}

export const INGREDIENT_LIMITS = {
  nameMax: 120,
  categoryNameMax: 60,
  /** The largest usual price per unit, in UZS (the ledger's largest amount). */
  priceMax: FINANCE_LIMITS.amountMax,
  piecesMax: 100_000,
} as const;

/** The catalogue's two lists: in use (shown in the pickers) and archived (kept for old receipts). */
export const INGREDIENT_STATUSES = ["active", "archived"] as const;
export type IngredientStatus = (typeof INGREDIENT_STATUSES)[number];

export function isIngredientStatus(value: unknown): value is IngredientStatus {
  return typeof value === "string" && (INGREDIENT_STATUSES as readonly string[]).includes(value);
}

export type IngredientCategory = {
  id: string;
  name_ru: string;
  name_uz: string;
  name_uzc: string;
  sort: number;
};

export type Ingredient = {
  id: string;
  name_ru: string;
  name_uz: string;
  name_uzc: string;
  category_id: string;
  unit: IngredientUnit;
  /** Whole UZS per unit; null when not known. */
  usual_price: number | null;
  pieces_per_unit: number | null;
  archived_at: string | null;
  updated_at: string;
};

export type IngredientField = "name_ru" | "name_uz" | "name_uzc" | "category" | "unit" | "usual_price" | "pieces_per_unit";
export type IngredientProblem = "required" | "too_long" | "invalid" | "duplicate";
export type IngredientErrors = Partial<Record<IngredientField, IngredientProblem>>;

export type IngredientInput = {
  name_ru: string;
  name_uz: string;
  name_uzc: string;
  category_id: string;
  unit: string;
  /** As typed ("12 500"); empty means unknown. */
  usual_price: string;
  /** As typed; empty means not counted in pieces. */
  pieces_per_unit: string;
};

/** Length as Postgres char_length counts it: code points, not UTF-16 units. */
const length = (value: string) => [...value].length;

/**
 * A whole number typed with spaces as thousands separators ("12 500", "12 500"): the number, null for an empty
 * field, or "invalid". No decimals, no signs: amounts are whole UZS.
 */
export function readWholeNumber(raw: string): number | null | "invalid" {
  const value = raw.replace(/[\s  ]/g, "");
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return "invalid";
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : "invalid";
}

export function checkIngredient(input: IngredientInput, categoryIds: readonly string[] | null): IngredientErrors {
  const errors: IngredientErrors = {};
  for (const field of ["name_ru", "name_uz"] as const) {
    const value = input[field].trim();
    if (!value) errors[field] = "required";
    else if (length(value) > INGREDIENT_LIMITS.nameMax) errors[field] = "too_long";
  }
  if (length(input.name_uzc.trim()) > INGREDIENT_LIMITS.nameMax) errors.name_uzc = "too_long";
  if (!input.category_id || (categoryIds !== null && !categoryIds.includes(input.category_id))) errors.category = "required";
  if (!isIngredientUnit(input.unit)) errors.unit = "required";

  const price = readWholeNumber(input.usual_price);
  if (price === "invalid" || (price !== null && (price <= 0 || price > INGREDIENT_LIMITS.priceMax))) {
    errors.usual_price = "invalid";
  }
  const pieces = readWholeNumber(input.pieces_per_unit);
  if (pieces === "invalid" || (pieces !== null && (pieces < 1 || pieces > INGREDIENT_LIMITS.piecesMax))) {
    errors.pieces_per_unit = "invalid";
  }
  return errors;
}

export function hasIngredientErrors(errors: IngredientErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** The row an insert or update writes, from a checked input. */
export function ingredientRow(input: IngredientInput) {
  const price = readWholeNumber(input.usual_price);
  const pieces = readWholeNumber(input.pieces_per_unit);
  return {
    name_ru: input.name_ru.trim(),
    name_uz: input.name_uz.trim(),
    // Optional: empty means the panel converts the Latin name (src/lib/data/localized.ts).
    name_uzc: input.name_uzc.trim(),
    category_id: input.category_id,
    unit: input.unit as IngredientUnit,
    usual_price: typeof price === "number" ? price : null,
    pieces_per_unit: typeof pieces === "number" ? pieces : null,
  };
}

/** Category names: both required, at most 60 characters. */
export function checkCategoryName(name: string): IngredientProblem | null {
  const value = name.trim();
  if (!value) return "required";
  if (length(value) > INGREDIENT_LIMITS.categoryNameMax) return "too_long";
  return null;
}
