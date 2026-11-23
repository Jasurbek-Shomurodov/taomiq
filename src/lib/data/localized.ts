import type { Locale } from "@/i18n/config";
import { translit } from "@/lib/translit";

/** A catalogue row with a text field in every language: name_uz, name_ru and (optionally filled) name_uzc. */
type LocalizedRow<F extends string> = { [K in `${F}_uz` | `${F}_ru`]: string } & {
  [K in `${F}_uzc`]?: string | null;
};

/**
 * The one way to read catalogue text (programs, dishes) in a site language.
 * Cyrillic Uzbek uses the hand-written *_uzc value when there is one, otherwise the Latin text
 * converted on the fly, so the site is complete in Cyrillic before staff fill anything in.
 */
export function localized<F extends string>(row: LocalizedRow<F>, field: F, locale: Locale): string {
  // The signature checks the field names; inside, read the row as plain strings.
  const text = row as Record<string, string | null | undefined>;
  const latin = text[`${field}_uz`] ?? "";
  if (locale === "ru") return text[`${field}_ru`] ?? "";
  if (locale === "uz") return latin;
  const cyrillic = text[`${field}_uzc`];
  // A database without the *_uzc columns yet (before migration 0005) also lands here.
  return typeof cyrillic === "string" && cyrillic.trim() !== "" ? cyrillic : translit(latin);
}
