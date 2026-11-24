import { Suspense, type ReactNode } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang, type Locale } from "@/i18n/config";
import { site } from "@/lib/site";
import { LanguageSwitch } from "./LanguageSwitch";

/**
 * The page around the back office's signed-out screens (/login and /setup), so both look the same: forest with a
 * soft gold glow behind the card and darker edges (.admin-auth-bg in globals.css). The content reads the
 * admin_locale cookie, so it streams in behind a card-sized placeholder: pass the card's usual height as
 * `placeholderClassName` (a literal Tailwind class) so nothing jumps when it arrives.
 */
export function AuthShell({ children, placeholderClassName }: { children: ReactNode; placeholderClassName: string }) {
  return (
    <main className="admin-auth-bg relative flex min-h-dvh flex-col items-center justify-center px-4 pb-8 pt-20 sm:px-6">
      <Suspense
        fallback={
          <div
            className={`w-full max-w-md rounded-3xl border border-gold/25 bg-ivory/95 shadow-2xl shadow-forest-deep/60 ${placeholderClassName}`}
          />
        }
      >
        {children}
      </Suspense>
    </main>
  );
}

/**
 * The language switch in the page's top-right corner, the card (fades and rises once on load; still under
 * prefers-reduced-motion) and a quiet footer link back to the public site.
 */
export function AuthCard({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = getAdminDictionary(locale);
  const siteHost = new URL(site.url).host;
  return (
    <div lang={htmlLang[locale]} className="flex w-full flex-col items-center">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <LanguageSwitch locale={locale} label={t.switcher.label} />
      </div>
      <div className="w-full max-w-md rounded-3xl border border-gold/25 bg-ivory p-8 shadow-2xl shadow-forest-deep/60 motion-safe:animate-rise sm:p-10">
        {children}
      </div>
      <p className="mt-6 text-xs">
        <a
          href={site.url}
          className="press inline-flex min-h-11 items-center px-2 tracking-wide text-ivory/70 underline-offset-4 hover:text-ivory hover:underline"
        >
          {siteHost}
        </a>
      </p>
    </div>
  );
}
