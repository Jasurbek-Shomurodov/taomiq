import type { Locale } from "../config";
import ru, { type AdminDictionary } from "./ru";
import uz from "./uz";
import uzc from "./uzc";

// Record<Locale, …>: a new locale without an admin dictionary does not compile. Each dictionary is
// typed as AdminDictionary (the shape of ru.ts), so a missing key does not compile either.
// Client components import this too (the texts hold functions, so they cannot be passed as props).
const dictionaries: Record<Locale, AdminDictionary> = { uz, uzc, ru };

/** The back office's default language, before anyone has chosen one. */
export const defaultAdminLocale: Locale = "ru";

export function getAdminDictionary(locale: Locale): AdminDictionary {
  return dictionaries[locale];
}

export type { AdminDictionary };
