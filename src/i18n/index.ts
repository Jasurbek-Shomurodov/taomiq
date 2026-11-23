import ru, { type Dictionary } from "./ru";
import uz from "./uz";
import uzc from "./uzc";
import type { Locale } from "./config";

// Record<Locale, …>: a new locale without a dictionary does not compile. Each dictionary is typed
// as Dictionary (the shape of ru.ts), so a missing key does not compile either.
const dictionaries: Record<Locale, Dictionary> = { uz, uzc, ru };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export type { Dictionary };
