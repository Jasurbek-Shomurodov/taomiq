"use server";

import { RedirectType, redirect } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { requireStockAccess } from "./auth";
import type { IngredientUnit } from "./ingredients";
import { listIngredients } from "./stock-queries";
import { loadCostPreview, loadRecipes } from "./tech-card-queries";
import {
  TECH_CARD_LIMITS,
  checkTechCard,
  hasTechCardErrors,
  isTechUnit,
  readTechLinesField,
  type CostPreview,
  type TechCardErrors,
  type TechLinePayload,
  type TechLineProblem,
  type TechUnit,
} from "./tech-cards";

/*
 * Tech card writes and the editor's live cost (docs/plans/zarkebab-feature-port.md, slice 7), owners and managers only
 * (requireStockAccess; the database functions check the role again). A card and its lines are written together by
 * public.tech_card_save (migration 0023). Errors are logged with their code and shown as a sentence in the staff
 * member's language.
 */

export type TechCardFormState = { errors?: TechCardErrors; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

/** The error code of a tech card function, from the message it raised. */
function code(error: { message: string }): string {
  return error.message.trim().split(/\s/)[0] ?? "";
}

/**
 * Saves a dish's card (creates it the first time). The form sends the updated_at it was loaded with (empty for a dish
 * that had no card); a card changed since is not overwritten. On success: the card page again, with the saved card.
 */
export async function saveTechCard(_prev: TechCardFormState, form: FormData): Promise<TechCardFormState> {
  const { supabase, staff } = await requireStockAccess();
  const t = getAdminDictionary(staff.locale).techCards;

  const dishId = text(form, "dish_id").trim();
  const loadedAt = text(form, "loaded_at").trim();
  const drafts = readTechLinesField(text(form, "lines"));
  if (!UUID_RE.test(dishId) || !drafts) return { error: t.errors.failed };

  // The units come from the catalogue as it is now, not from the browser.
  let units: Map<string, IngredientUnit>;
  try {
    units = new Map((await listIngredients(supabase)).map((i) => [i.id, i.unit]));
  } catch (error) {
    console.error("tech cards: ingredients read failed", error instanceof Error ? error.message : error);
    return { error: t.errors.failed };
  }

  const input = { batch: text(form, "batch_output_g"), method: text(form, "method"), notes: text(form, "notes"), lines: drafts };
  const { errors, payload, batch } = checkTechCard(input, (id) => units.get(id) ?? null);
  if (hasTechCardErrors(errors)) return { errors };

  const formIndex = drafts
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.ingredientId || line.quantity.trim())
    .map(({ index }) => index);

  const { error } = await supabase.rpc("tech_card_save", {
    p_dish_id: dishId,
    p_batch_output_g: batch,
    p_method: input.method,
    p_notes: input.notes,
    p_lines: payload,
    p_loaded_at: loadedAt || null,
  });
  if (error) {
    const c = code(error);
    const position = Number(error.details);
    const lineAt = Number.isSafeInteger(position) && position >= 1 ? formIndex[position - 1] : undefined;
    const lineError = (problem: TechLineProblem, message?: string): TechCardFormState =>
      lineAt === undefined
        ? { error: message ?? t.errors.failed }
        : { error: message, errors: { form: [], lines: { [lineAt]: [problem] } } };
    switch (c) {
      case "stale":
        return { error: t.errors.stale };
      case "not_found":
        return { error: t.errors.notFound };
      case "bad_batch":
        return { errors: { form: ["batch"], lines: {} } };
      case "method_too_long":
        return { errors: { form: ["method"], lines: {} } };
      case "notes_too_long":
        return { errors: { form: ["notes"], lines: {} } };
      case "no_lines":
      case "too_many_lines":
        return { errors: { form: ["lines"], lines: {} } };
      case "duplicate_ingredient":
        return lineError("duplicate");
      case "ingredient_archived":
        return lineError("ingredient", t.errors.archived);
      case "unit_mismatch":
        return lineError("ingredient", t.errors.unit);
      case "invalid_ingredient":
      case "invalid_line":
        return lineError("ingredient");
      case "invalid_quantity":
        return lineError("quantity");
      case "not_allowed":
        return { error: t.errors.notAllowed };
      default:
        console.error("tech cards: save failed", error.code, c);
        return { error: t.errors.failed };
    }
  }

  // A fresh page with the saved card (and its new updated_at), saying so.
  redirect(`/tech-cards/${dishId}?saved=1`, RedirectType.replace);
}

/**
 * The editor's live cost: the cost rule of the database over the recipe as typed (not saved). Called from the editor
 * a moment after typing stops. Null on any failure (the editor then says the cost could not be worked out).
 */
export async function previewTechCardCost(input: {
  batchOutputG: number | null;
  portionG: number;
  lines: TechLinePayload[];
}): Promise<CostPreview | null> {
  const { supabase } = await requireStockAccess();
  const lines = (Array.isArray(input?.lines) ? input.lines : [])
    .slice(0, TECH_CARD_LIMITS.lines)
    .filter((line) => line && UUID_RE.test(String(line.ingredient_id)) && isTechUnit(line.unit))
    .map((line) => ({ ingredient_id: String(line.ingredient_id), quantity: String(line.quantity), unit: line.unit }));
  const batch = Number.isSafeInteger(input?.batchOutputG) ? Number(input.batchOutputG) : null;
  const portion = Number.isSafeInteger(input?.portionG) ? Number(input.portionG) : 0;
  try {
    return await loadCostPreview(supabase, { batchOutputG: batch, portionG: portion, lines });
  } catch (error) {
    console.error("tech cards: cost preview failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/** "Copy from another dish": that dish's recipe (batch output, method and lines), or null when it has none. */
export async function loadRecipeForCopy(
  dishId: string,
): Promise<{ batchOutputG: number; method: string; lines: { ingredientId: string; milli: number; unit: TechUnit }[] } | null> {
  const { supabase } = await requireStockAccess();
  if (!UUID_RE.test(String(dishId))) return null;
  try {
    const recipe = (await loadRecipes(supabase, [dishId])).get(dishId);
    if (!recipe) return null;
    return {
      batchOutputG: recipe.batchOutputG,
      method: recipe.method,
      // The stored unit goes along: the editor clears a line whose unit no longer fits its ingredient.
      lines: recipe.lines.map((line) => ({ ingredientId: line.ingredientId, milli: line.milli, unit: line.unit })),
    };
  } catch (error) {
    console.error("tech cards: copy read failed", error instanceof Error ? error.message : error);
    return null;
  }
}
