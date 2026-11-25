import type { AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { foldSearchText } from "@/lib/admin/dish-status";
import type { Ingredient, IngredientUnit } from "@/lib/admin/ingredients";
import { localized } from "@/lib/data/localized";
import type { PickerIngredient } from "./IngredientPicker";

/** An ingredient with what the purchase form needs: the picker's fields plus the unit and the usual price. */
export type FormIngredient = PickerIngredient & { unit: IngredientUnit; usualPrice: number | null };

/** The purchase form's entry for an ingredient, in the reader's language. Used by the pages and by the form. */
export function formIngredient(
  ingredient: Ingredient,
  categoryName: string,
  t: AdminDictionary,
  locale: Locale,
): FormIngredient {
  return {
    id: ingredient.id,
    name: localized(ingredient, "name", locale),
    search: foldSearchText([ingredient.name_ru, ingredient.name_uz, localized(ingredient, "name", "uzc")].join(" ")),
    unitLabel: t.ingredients.units[ingredient.unit],
    category: categoryName,
    archived: ingredient.archived_at !== null,
    unit: ingredient.unit,
    usualPrice: ingredient.usual_price,
  };
}
