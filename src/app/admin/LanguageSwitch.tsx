import { htmlLang, localeLabel, localeName, locales, type Locale } from "@/i18n/config";
import { setAdminLocale } from "@/lib/admin/actions";

/**
 * The back-office language: three compact buttons, each label in its own language and script.
 * A plain form, so it works before the page's JavaScript has loaded.
 */
export function LanguageSwitch({
  locale,
  label,
  onLight = false,
}: {
  locale: Locale;
  /** Accessible name of the group, in the current language. */
  label: string;
  /** Colours for a light background (login page); the default suits the dark header. */
  onLight?: boolean;
}) {
  // onLight follows the panel theme (kit tokens); the default sits on the sign-in screens' forest, dark in both themes.
  const idle = onLight ? "text-adm-muted hover:text-adm-brand-ink" : "text-ivory/70 hover:text-ivory";
  const active = onLight ? "bg-adm-accent text-adm-on-accent" : "bg-ivory/15 text-ivory";
  return (
    <form action={setAdminLocale} role="group" aria-label={label} className="flex items-center gap-0.5 text-xs font-semibold">
      {locales.map((code) => (
        <button
          key={code}
          type="submit"
          name="locale"
          value={code}
          lang={htmlLang[code]}
          aria-label={localeName[code]}
          aria-pressed={code === locale}
          className={`cursor-pointer rounded-full px-2 py-1 ${code === locale ? active : idle}`}
        >
          {localeLabel[code]}
        </button>
      ))}
    </form>
  );
}

/**
 * The same switch as a segmented control, for the panel's sidebar foot (.adm-segmented, full width). Same action,
 * also a plain form.
 */
export function LanguageSegmented({ locale, label }: { locale: Locale; label: string }) {
  return (
    <form action={setAdminLocale} role="group" aria-label={label} className="adm-segmented flex w-full">
      {locales.map((code) => (
        <button
          key={code}
          type="submit"
          name="locale"
          value={code}
          lang={htmlLang[code]}
          aria-label={localeName[code]}
          aria-pressed={code === locale}
        >
          {localeLabel[code]}
        </button>
      ))}
    </form>
  );
}
