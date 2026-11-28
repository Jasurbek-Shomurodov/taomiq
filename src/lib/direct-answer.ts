import type { Dictionary } from "@/i18n";
import { formatSum } from "@/i18n/config";

/*
 * The direct answer each key page opens with (docs/plans/findability-and-growth.md, slice 2): two sentences in the hero
 * lead, built from t.answer and the catalogue. The first says what the page is about and where (Tashkent); the second
 * gives the lowest price per day (the same "from" figure as the hero and the phone bar, lowestPricePerDay) and how to
 * order. Without a price (the catalogue could not be read) the second says how to order only.
 */

type Words = Dictionary["answer"];

/** "a", "a и b", "a, b и c". */
export function joinWords(items: readonly string[], last: string): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}`;
}

/** "TAOMIQ", or "TAOMIQ LIGHT, BALANCE и PROTEIN" with program names. */
export function brandWith(words: Words, names: readonly string[] = []): string {
  return names.length > 0 ? `TAOMIQ ${joinWords(names, words.and)}` : "TAOMIQ";
}

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);
}

/** The page's first sentence (its template filled in), then the price and ordering sentence. */
export function directAnswer(
  words: Words,
  template: string,
  values: Record<string, string>,
  fromPrice: number | null,
): string {
  const order = fromPrice === null ? words.orderNoPrice : fill(words.orderWithPrice, { price: formatSum(fromPrice) });
  return `${fill(template, values)} ${order}`;
}
