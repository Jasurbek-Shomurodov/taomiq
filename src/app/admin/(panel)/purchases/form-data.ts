import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { Buyer } from "@/lib/admin/purchases";
import { listCategories, listIngredients, loadBuyers, loadPurchaseLockedThrough } from "@/lib/admin/stock-queries";
import { localized } from "@/lib/data/localized";
import { formIngredient, type FormIngredient } from "./form-ingredient";

export type PurchaseFormData = {
  ingredients: FormIngredient[];
  categories: { id: string; name: string }[];
  /** Null when the list could not be read (the form then keeps the buyer as it is). */
  buyers: Buyer[] | null;
  /** Null when no month is closed, or when it could not be read (the database refuses a closed month anyway). */
  lockedThrough: string | null;
};

/**
 * What the purchase form needs: the catalogue (the pickers hide archived ingredients themselves), the categories for
 * "add to catalogue", the buyers and the closed-month day. Throws when the catalogue cannot be read; the buyers and
 * the closed day are optional.
 */
export async function loadPurchaseFormData(
  supabase: SupabaseClient,
  t: AdminDictionary,
  locale: Locale,
): Promise<PurchaseFormData> {
  const [ingredients, categories, buyers, locked] = await Promise.allSettled([
    listIngredients(supabase),
    listCategories(supabase),
    loadBuyers(supabase),
    loadPurchaseLockedThrough(supabase),
  ]);
  if (ingredients.status === "rejected") throw ingredients.reason;
  if (categories.status === "rejected") throw categories.reason;
  if (buyers.status === "rejected") console.error("purchases: buyers failed", String(buyers.reason));
  if (locked.status === "rejected") console.error("purchases: locked day failed", String(locked.reason));

  const names = new Map(categories.value.map((c) => [c.id, localized(c, "name", locale)]));
  const collator = new Intl.Collator(locale === "ru" ? "ru" : "uz");
  return {
    ingredients: ingredients.value
      .map((ingredient) => formIngredient(ingredient, names.get(ingredient.category_id) ?? "—", t, locale))
      .sort((a, b) => collator.compare(a.name, b.name)),
    categories: categories.value.map((c) => ({ id: c.id, name: names.get(c.id) ?? c.name_ru })),
    buyers: buyers.status === "fulfilled" ? buyers.value : null,
    lockedThrough: locked.status === "fulfilled" ? locked.value : null,
  };
}
