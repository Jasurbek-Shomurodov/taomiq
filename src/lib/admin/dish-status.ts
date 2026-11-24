import type { Dish } from "@/lib/data/types";

/**
 * The dishes list's status filter (?status= on /dishes) and the overview's dish tiles, from one place, so the
 * number on a tile is the number of rows the list shows when the tile is opened. The meaning of each key follows the
 * badges on the list: "hidden" is a dish switched off for the site, "no-card" one without a verified card and
 * "no-photo" one without a photo, whether visible or not. No key (or an unknown one) is "all".
 */
export const DISH_STATUS_FILTERS = ["visible", "hidden", "no-card", "no-photo"] as const;
export type DishStatusFilter = (typeof DISH_STATUS_FILTERS)[number];

export function isDishStatusFilter(value: string): value is DishStatusFilter {
  return (DISH_STATUS_FILTERS as readonly string[]).includes(value);
}

export function matchesDishStatus(
  dish: Pick<Dish, "active" | "verified" | "photo_url">,
  filter: DishStatusFilter,
): boolean {
  switch (filter) {
    case "visible":
      return dish.active;
    case "hidden":
      return !dish.active;
    case "no-card":
      return !dish.verified;
    case "no-photo":
      return !dish.photo_url;
  }
}

/** The dishes list, optionally filtered: "/dishes", "/dishes?status=no-photo". */
export function dishesHref(filter?: DishStatusFilter): string {
  return filter ? `/dishes?status=${filter}` : "/dishes";
}
