import type { Nutrition } from "./types";

/**
 * Dish badges, computed only from the dish's own portion numbers. No editorial badges ("Top rated",
 * "New", "Chef's pick"): there is no data behind them until ratings exist.
 */

/** "High protein": at least this many grams of protein in the portion. */
export const HIGH_PROTEIN_MIN_G = 30;
/** "Light": at most this many kcal in the portion. */
export const LIGHT_MAX_KCAL = 350;
/** A card never shows more than this many badges. */
export const MAX_BADGES = 2;

export type DishBadge = "highProtein" | "light";

/** The badges a portion earns, in display order, at most MAX_BADGES. */
export function dishBadges(portion: Pick<Nutrition, "kcal" | "protein">): DishBadge[] {
  const badges: DishBadge[] = [];
  if (portion.protein >= HIGH_PROTEIN_MIN_G) badges.push("highProtein");
  if (portion.kcal > 0 && portion.kcal <= LIGHT_MAX_KCAL) badges.push("light");
  return badges.slice(0, MAX_BADGES);
}
