import type { Locale } from "@/i18n/config";

/*
 * The allergen vocabulary shared by dishes (dishes.allergens) and orders (orders.exclusion_tags, migration 0031):
 * the order form's chips, the menu's allergen filter, the back-office dish checkboxes and the kitchen sheet.
 * docs/plans/allergen-exclusions.md. The keys are the codes the back office has always written on dishes, plus
 * mushrooms; private.exclusion_tags_valid (0031) holds the same list: keep them in step.
 *
 * Plain module (no "use client", no server-only): the order form, the menu page and the server action all import it.
 */

/** The fixed list, in the order chips and sheets show it. */
export const ALLERGEN_KEYS = [
  "gluten",
  "milk",
  "egg",
  "nuts",
  "peanut",
  "fish",
  "seafood",
  "sesame",
  "soy",
  "mushrooms",
] as const;

export type AllergenKey = (typeof ALLERGEN_KEYS)[number];

/**
 * Every name in every site language. The keys of the fixed list, plus codes older dishes may still carry (honey):
 * those are shown on the dish and kept by the dish editor, but are not offered as a choice.
 */
const NAMES: Record<string, Record<Locale, string>> = {
  gluten: { ru: "Глютен", uz: "Glyuten", uzc: "Глютен" },
  milk: { ru: "Молоко", uz: "Sut", uzc: "Сут" },
  egg: { ru: "Яйца", uz: "Tuxum", uzc: "Тухум" },
  nuts: { ru: "Орехи", uz: "Yongʻoq", uzc: "Ёнғоқ" },
  peanut: { ru: "Арахис", uz: "Yeryongʻoq", uzc: "Ерёнғоқ" },
  fish: { ru: "Рыба", uz: "Baliq", uzc: "Балиқ" },
  seafood: { ru: "Морепродукты", uz: "Dengiz mahsulotlari", uzc: "Денгиз маҳсулотлари" },
  sesame: { ru: "Кунжут", uz: "Kunjut", uzc: "Кунжут" },
  soy: { ru: "Соя", uz: "Soya", uzc: "Соя" },
  mushrooms: { ru: "Грибы", uz: "Qoʻziqorin", uzc: "Қўзиқорин" },
  // Not on the fixed list: older dishes may carry it.
  honey: { ru: "Мёд", uz: "Asal", uzc: "Асал" },
};

/**
 * The words written at the front of an order's exclusions text, in the order's language: "Без: молоко, орехи. ".
 * Staff and the kitchen read them in every place that shows the text, also where the tags are not shown.
 */
const PREFIX: Record<Locale, string> = { ru: "Без", uz: "Boʻlmasin", uzc: "Бўлмасин" };

export function isAllergenKey(value: unknown): value is AllergenKey {
  return typeof value === "string" && (ALLERGEN_KEYS as readonly string[]).includes(value);
}

/** The name of an allergen code; an unknown code is shown as stored (an allergen must never disappear). */
export function allergenName(code: string, locale: Locale): string {
  return NAMES[code]?.[locale] ?? code;
}

/** Known keys only, each once, in the list's order. */
export function normalizeTags(values: Iterable<unknown>): AllergenKey[] {
  const chosen = new Set<unknown>(values);
  return ALLERGEN_KEYS.filter((key) => chosen.has(key));
}

/** `?allergens=milk,nuts` → ["milk", "nuts"]. Unknown or repeated keys are dropped. */
export function parseAllergenParam(value: string | string[] | undefined): AllergenKey[] {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return normalizeTags(raw.split(",").map((part) => part.trim().toLowerCase()));
}

/** The names joined for a sentence, lower case: "молоко, орехи". */
export function allergenWords(tags: readonly string[], locale: Locale): string {
  return tags.map((tag) => allergenName(tag, locale).toLocaleLowerCase(locale === "uz" ? "uz" : "ru")).join(", ");
}

/** "Без: молоко, орехи. " for the chosen keys, "" for none. */
export function exclusionPrefix(tags: readonly AllergenKey[], locale: Locale): string {
  return tags.length > 0 ? `${PREFIX[locale]}: ${allergenWords(tags, locale)}. ` : "";
}

/**
 * The exclusions text saved on the order: the chosen allergens in words, then what the customer typed.
 * "Без: молоко, орехи. лук"; only the free text when nothing is chosen.
 */
export function composeExclusions(tags: readonly AllergenKey[], other: string, locale: Locale): string {
  return `${exclusionPrefix(tags, locale)}${other.trim()}`.trim();
}

/**
 * The reverse of composeExclusions, for an order repeated from the account and for the kitchen sheet: the keys named
 * in a leading "Без: …." (in any site language) and the text after it. When the text does not start that way, or
 * names something off the list, nothing is taken apart: no tags, the whole text.
 */
export function parseExclusions(text: string): { tags: AllergenKey[]; other: string } {
  const whole = { tags: [] as AllergenKey[], other: text.trim() };
  for (const locale of Object.keys(PREFIX) as Locale[]) {
    const head = `${PREFIX[locale]}: `;
    if (!whole.other.startsWith(head)) continue;
    const end = whole.other.indexOf(".", head.length);
    if (end < 0) return whole;
    const words = whole.other.slice(head.length, end).split(",").map((w) => w.trim());
    const tags: AllergenKey[] = [];
    for (const word of words) {
      const key = ALLERGEN_KEYS.find((k) => allergenWords([k], locale) === word);
      if (!key) return whole;
      tags.push(key);
    }
    return { tags: normalizeTags(tags), other: whole.other.slice(end + 1).trim() };
  }
  return whole;
}

/**
 * The allergens an order leaves out, as the kitchen sheet groups them, and the text to show beside them. The exclusions
 * text is the source of truth: staff may edit it after the order (the stored tags, orders.exclusion_tags, are set once,
 * at order). A leading "Без: …." in the text gives the tags, and `text` is what follows it. Without that prefix, the
 * stored tags count only while the text still names every one of them (in any site language), and `text` is the whole
 * text; otherwise there are no tags and the whole text is shown.
 */
export function exclusionTagsOf(exclusions: string, stored: readonly string[]): { tags: AllergenKey[]; text: string } {
  const whole = exclusions.trim();
  const parsed = parseExclusions(whole);
  if (parsed.tags.length > 0) return { tags: parsed.tags, text: parsed.other };
  const tags = normalizeTags(stored);
  const lower = whole.toLocaleLowerCase("ru");
  const named = (tag: AllergenKey) =>
    (Object.keys(PREFIX) as Locale[]).some((locale) => lower.includes(allergenWords([tag], locale).toLocaleLowerCase("ru")));
  return { tags: tags.length > 0 && tags.every(named) ? tags : [], text: whole };
}

/** The keys among `tags` that a dish carries (dishes.allergens). */
export function allergensIn(dishAllergens: readonly string[], tags: readonly AllergenKey[]): AllergenKey[] {
  return tags.filter((tag) => dishAllergens.includes(tag));
}
