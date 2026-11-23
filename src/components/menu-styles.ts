/**
 * Class lists shared by the menu browser and its loading skeleton, so the skeleton has exactly
 * the geometry of the content that replaces it (no layout jump when the day streams in).
 * Plain module (not "use client"): server and client components both import the values.
 */

/** Program and calorie chips: 38 px tall. */
export const CHIP = "rounded-full border px-4 py-2 text-sm font-semibold";

/**
 * Day row. Phones: one snapping row that bleeds to the screen edges, with edge fades (.day-scroller
 * in globals.css). From md: two rows of fifteen, nothing to scroll.
 */
export const DAY_ROW =
  "day-scroller relative -mx-5 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-5 py-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-[repeat(15,2.75rem)] md:justify-between md:gap-x-1 md:gap-y-2 md:overflow-visible md:px-0";

/** One day: a 44 px circle. */
export const DAY_CIRCLE =
  "relative flex size-11 shrink-0 snap-center items-center justify-center rounded-full border text-sm tabular-nums";

/** Dish list: one column of horizontal cards on phones, a grid of tall cards from sm. */
export const DISH_LIST = "grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3";

/** Dish card: 112 px square image left of the text on phones, image on top from sm. */
export const DISH_CARD =
  "flex gap-3 overflow-hidden rounded-2xl border border-line bg-white p-3 sm:flex-col sm:gap-0 sm:p-0";

export const DISH_IMAGE =
  "relative size-28 shrink-0 overflow-hidden rounded-xl bg-ivory-deep sm:aspect-[4/3] sm:size-auto sm:w-full sm:rounded-none";

export const DISH_BODY = "flex min-w-0 flex-1 flex-col sm:p-4";
