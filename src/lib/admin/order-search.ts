/**
 * The orders list's search box (?q= on /orders): by order number, phone digits or customer name. Pure functions,
 * shared by the page and the PostgREST query, so the escaping can be checked on its own.
 *
 * The term goes into a PostgREST `or()` filter, whose grammar gives meaning to `,` `.` `:` `(` `)` `"` `\` and,
 * inside `ilike`, `%` `_` `*`. So the input is reduced to letters (any script: names are in Latin and Cyrillic),
 * ASCII digits, spaces and `+` before anything is built from it; every other character becomes a word break. The
 * only `%`, `,`, `(`, `)` and `.` in the filter are the ones written here.
 */

/** Longest term that is searched (after cleaning), in characters (code points). */
export const ORDER_SEARCH_MAX = 40;

/** Raw input is cut to this many characters before any regex runs, so a huge ?q= costs nothing. */
const RAW_MAX = 200;

/** Phones are matched only from this many digits: fewer would match nearly every order. */
const PHONE_MIN_DIGITS = 4;

/** The first `max` characters, never splitting a character made of two UTF-16 units (an emoji, say). */
export function cutCodePoints(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/**
 * Every apostrophe form, the Uzbek ones (ʻ U+02BB, ʼ U+02BC) included: they are letters to Unicode, but people
 * type "Oʻtkir", "O'tkir" and "O‘tkir" for the same name, so all of them break words alike.
 */
const APOSTROPHES = /[ʻʼ'‘’`´]/g;

/**
 * Letters, ASCII digits, spaces and "+" only; runs of anything else (apostrophes included) become one space.
 * "Oʻtkir" and "O'tkir" both become "O tkir", which the name pattern below matches against either spelling.
 */
export function cleanOrderSearch(raw: string): string {
  const clean = cutCodePoints(raw, RAW_MAX)
    .normalize("NFC")
    .replace(APOSTROPHES, " ")
    .replace(/[^\p{L}\p{M}0-9+]+/gu, " ")
    .trim();
  return cutCodePoints(clean, ORDER_SEARCH_MAX).trim();
}

/**
 * The `or()` filter for a term, or null when there is nothing to search for:
 * - all digits: `number.eq.<n>` (when a safe integer) and, from four digits, `phone.ilike.%<digits>%`
 *   (phones are stored as +998XXXXXXXXX, so "+998 90 123-45-67" and "90 123 45 67" match on their digits);
 * - letters only (digits under four): `customer_name.ilike.%w1%w2%`, the letter words in order with anything
 *   between them, so a removed apostrophe or a middle name does not stop a match;
 * - letters and four or more digits: `and(customer_name.ilike.…,phone.ilike.…)`, the name and the phone together.
 */
export function orderSearchFilter(term: string): string | null {
  const clean = cleanOrderSearch(term);
  if (!clean) return null;

  const digits = clean.replace(/[^0-9]/g, "");
  const phone = digits.length >= PHONE_MIN_DIGITS ? `phone.ilike.%${digits}%` : null;
  // Name words: the letters of each word (digits and "+" dropped), empty ones skipped.
  const words = clean
    .split(" ")
    .map((word) => word.replace(/[^\p{L}\p{M}]/gu, ""))
    .filter(Boolean);
  const name = words.length > 0 ? `customer_name.ilike.%${words.join("%")}%` : null;

  if (name && phone) return `and(${name},${phone})`;
  if (name) return name;

  const parts: string[] = [];
  if (/^[0-9]+$/.test(clean)) {
    const n = Number(clean);
    if (Number.isSafeInteger(n)) parts.push(`number.eq.${n}`);
  }
  if (phone) parts.push(phone);
  return parts.length > 0 ? parts.join(",") : null;
}
