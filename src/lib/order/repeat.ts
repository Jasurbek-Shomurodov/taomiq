/**
 * "Repeat last order" (docs/plans/saved-address-repeat-order.md): which program and level of today's catalogue an earlier
 * order maps to. Plain module (no server-only), so it can be checked on its own.
 */

type CatalogueProgram = { slug: string; variants: readonly { id: string; kcal: number }[] };

export type RepeatPick =
  /** The order's own level is still offered. */
  | { kind: "same"; programSlug: string; variantId: string }
  /** The level is gone; the same program's nearest level instead (ties: the lower one). */
  | { kind: "nearest"; programSlug: string; variantId: string; fromKcal: number; toKcal: number }
  /** The program is gone too: the caller keeps its default choice. */
  | { kind: "none" };

export function pickRepeatVariant(
  programs: readonly CatalogueProgram[],
  order: { variantId: string; programSlug: string; kcal: number },
): RepeatPick {
  for (const program of programs) {
    if (program.variants.some((v) => v.id === order.variantId)) {
      return { kind: "same", programSlug: program.slug, variantId: order.variantId };
    }
  }
  const program = order.programSlug ? programs.find((p) => p.slug === order.programSlug) : undefined;
  if (!program || program.variants.length === 0) return { kind: "none" };
  let best = program.variants[0];
  for (const variant of program.variants) {
    const distance = Math.abs(variant.kcal - order.kcal);
    const bestDistance = Math.abs(best.kcal - order.kcal);
    if (distance < bestDistance || (distance === bestDistance && variant.kcal < best.kcal)) best = variant;
  }
  return { kind: "nearest", programSlug: program.slug, variantId: best.id, fromKcal: order.kcal, toKcal: best.kcal };
}

/** The order number of ?repeat=, or null when it is not a plain positive number. */
export function repeatNumberOf(raw: string | undefined): number | null {
  if (!raw || !/^[1-9][0-9]{0,14}$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}
