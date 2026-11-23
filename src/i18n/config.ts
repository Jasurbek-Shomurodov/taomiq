export const locales = ["uz", "ru"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "uz";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** Russian-style plural: forms = ["день", "дня", "дней"]. Uzbek dictionaries repeat one form. */
export function plural(n: number, forms: readonly string[]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Group thousands with a thin space: 215000 → "215 000". */
export function formatSum(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
