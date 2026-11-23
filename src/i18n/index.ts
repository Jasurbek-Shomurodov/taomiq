import ru, { type Dictionary } from "./ru";
import uz from "./uz";
import type { Locale } from "./config";

const dictionaries: Record<Locale, Dictionary> = { uz, ru };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export type { Dictionary };
