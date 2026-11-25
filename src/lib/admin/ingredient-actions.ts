"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import type { FormState } from "./actions";
import { requireOwner, requireStockAccess } from "./auth";
import {
  checkCategoryName,
  checkIngredient,
  hasIngredientErrors,
  ingredientRow,
  isIngredientUnit,
  type Ingredient,
  type IngredientErrors,
  type IngredientInput,
} from "./ingredients";

/*
 * Ingredient catalogue writes (docs/plans/zarkebab-feature-port.md, slice 6; migration 0022). Owners and managers add
 * and edit ingredients (requireStockAccess; the table's policies check the same role); only the owner adds and renames
 * categories. Ingredients are archived, never deleted. Database errors are logged with their code and shown as a
 * sentence in the staff member's language.
 */

export type IngredientFormState = { fields?: IngredientErrors; error?: string; ok?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function readInput(form: FormData): IngredientInput {
  return {
    name_ru: text(form, "name_ru"),
    name_uz: text(form, "name_uz"),
    name_uzc: text(form, "name_uzc"),
    category_id: text(form, "category_id"),
    unit: text(form, "unit"),
    usual_price: text(form, "usual_price"),
    pieces_per_unit: text(form, "pieces_per_unit"),
  };
}

/** A refused write → the field it is about, or null. 23505: an active ingredient has the name; 23503: no such category. */
function dbFieldError(error: { code?: string; message: string }): IngredientErrors | null {
  if (error.code === "23505") {
    return error.message.includes("name_uz") ? { name_uz: "duplicate" } : { name_ru: "duplicate" };
  }
  if (error.code === "23503") return { category: "required" };
  return null;
}

/** Adds (no id) or saves an ingredient, then goes back to the catalogue. */
export async function saveIngredient(_prev: IngredientFormState, form: FormData): Promise<IngredientFormState> {
  const { supabase, staff } = await requireStockAccess();
  const t = getAdminDictionary(staff.locale).ingredients;
  const id = text(form, "id");
  if (id && !UUID_RE.test(id)) return { error: t.errors.notFound };

  const input = readInput(form);
  const fields = checkIngredient(input, null);
  if (hasIngredientErrors(fields)) return { fields };
  const row = ingredientRow(input);

  const { data, error } = id
    ? await supabase.from("ingredients").update(row).eq("id", id).select("id")
    : await supabase.from("ingredients").insert(row).select("id");
  if (error) {
    const field = dbFieldError(error);
    if (field) return { fields: field };
    console.error("ingredients: save failed", error.code);
    return { error: t.errors.failed };
  }
  if (!data?.length) return { error: t.errors.notFound };

  redirect("/ingredients");
}

/** Archives (archive=1) or restores an ingredient. The editor page refreshes and says which. */
export async function setIngredientArchived(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireStockAccess();
  const t = getAdminDictionary(staff.locale).ingredients;
  const id = text(form, "id");
  const archive = text(form, "archive") === "1";
  if (!UUID_RE.test(id)) return { error: t.errors.notFound };

  const { data, error } = await supabase
    .from("ingredients")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) {
    console.error("ingredients: archive failed", error.code);
    if (error.code === "23505") return { error: t.errors.duplicateRestore };
    return { error: t.errors.failed };
  }
  if (!data?.length) return { error: t.errors.notFound };
  refresh();
  return { ok: archive ? t.archived : t.restored };
}

/**
 * Adds an ingredient from the purchase form ("not in the catalogue"), and returns it so the form can pick it at once.
 * Called directly from the client (not through a form).
 */
export async function quickAddIngredient(
  input: IngredientInput,
): Promise<{ ingredient?: Ingredient; fields?: IngredientErrors; error?: string }> {
  const { supabase, staff } = await requireStockAccess();
  const t = getAdminDictionary(staff.locale).ingredients;
  const clean: IngredientInput = {
    name_ru: String(input?.name_ru ?? "").trim(),
    name_uz: String(input?.name_uz ?? "").trim(),
    name_uzc: String(input?.name_uzc ?? "").trim(),
    category_id: String(input?.category_id ?? "").trim(),
    unit: String(input?.unit ?? "").trim(),
    usual_price: String(input?.usual_price ?? "").trim(),
    pieces_per_unit: "",
  };
  const fields = checkIngredient(clean, null);
  if (hasIngredientErrors(fields)) return { fields };

  const { data, error } = await supabase
    .from("ingredients")
    .insert(ingredientRow(clean))
    .select("id, name_ru, name_uz, name_uzc, category_id, unit, usual_price, pieces_per_unit, archived_at, updated_at")
    .single();
  if (error || !data) {
    const field = error ? dbFieldError(error) : null;
    if (field) return { fields: field };
    console.error("ingredients: quick add failed", error?.code);
    return { error: t.errors.failed };
  }
  const raw = data as Record<string, unknown>;
  return {
    ingredient: {
      id: String(raw.id),
      name_ru: String(raw.name_ru ?? ""),
      name_uz: String(raw.name_uz ?? ""),
      name_uzc: String(raw.name_uzc ?? ""),
      category_id: String(raw.category_id),
      unit: isIngredientUnit(raw.unit) ? raw.unit : "pcs",
      usual_price: raw.usual_price === null ? null : Number(raw.usual_price),
      pieces_per_unit: raw.pieces_per_unit === null ? null : Number(raw.pieces_per_unit),
      archived_at: null,
      updated_at: String(raw.updated_at ?? ""),
    },
  };
}

/** Adds (no id) or renames a category. Owner only. */
export async function saveCategory(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale).ingredients.categories;
  const id = text(form, "id");
  if (id && !UUID_RE.test(id)) return { error: t.failed };
  const row = { name_ru: text(form, "name_ru"), name_uz: text(form, "name_uz"), name_uzc: text(form, "name_uzc") };
  if (checkCategoryName(row.name_ru) || checkCategoryName(row.name_uz) || [...row.name_uzc].length > 60) {
    return { error: t.required };
  }

  const { data, error } = id
    ? await supabase.from("ingredient_categories").update(row).eq("id", id).select("id")
    : await supabase.from("ingredient_categories").insert(row).select("id");
  if (error) {
    console.error("ingredients: category save failed", error.code);
    if (error.code === "23505") return { error: t.duplicate };
    return { error: t.failed };
  }
  if (!data?.length) return { error: t.failed };
  refresh();
  return { ok: t.saved };
}
