/**
 * The site's languages. Everything that lists them (static params, sitemap, hreflang, the switch,
 * the proxy, isLocale) derives from this array. The code is the URL segment, the database column
 * suffix (name_uzc) and the dictionary file name.
 */
export const locales = ["uz", "uzc", "ru"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "uz";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** BCP 47 tag for <html lang>, hreflang and schema.org inLanguage. */
export const htmlLang: Record<Locale, string> = { uz: "uz-Latn", uzc: "uz-Cyrl", ru: "ru" };

/** Open Graph locale. There is no script variant for Uzbek, so both scripts say uz_UZ. */
export const ogLocale: Record<Locale, string> = { uz: "uz_UZ", uzc: "uz_UZ", ru: "ru_UZ" };

/** The language switch, each label in its own language and script. */
export const localeLabel: Record<Locale, string> = { uz: "Oʻz", uzc: "Ўз", ru: "Рус" };

/** The language's full name in that language, for the switch's accessible names. */
export const localeName: Record<Locale, string> = { uz: "Oʻzbekcha", uzc: "Ўзбекча", ru: "Русский" };

/** The language named in English, for machine-read summaries (/llms.txt). */
export const localeNameEn: Record<Locale, string> = {
  uz: "Uzbek (Latin script)",
  uzc: "Uzbek (Cyrillic script)",
  ru: "Russian",
};

/** The language named in Russian, for staff-facing text (order alerts, the admin). */
export const localeNameRu: Record<Locale, string> = {
  uz: "узбекский",
  uzc: "узбекский (кириллица)",
  ru: "русский",
};

/** Russian-style plural: forms = ["день", "дня", "дней"]. Both Uzbek dictionaries repeat one form. */
export function plural(n: number, forms: readonly string[]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/**
 * Group thousands with a no-break space (U+00A0): 215000 → "215 000", never wrapped mid-number.
 * Written as an escape so an editor cannot turn it into a plain space.
 */
export function formatSum(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
