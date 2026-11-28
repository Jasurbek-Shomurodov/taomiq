import type { Metadata } from "next";
import Link from "next/link";
import { locale as rootLocale } from "next/root-params";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary } from "@/i18n";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { notFoundMetadata } from "@/lib/seo";

/** The locale from the URL; an unknown one falls back to Uzbek. */
async function currentLocale(): Promise<Locale> {
  const value = await rootLocale();
  return value && isLocale(value) ? value : defaultLocale;
}

// Next adds <meta name="robots" content="noindex"> to 404 responses itself. For unknown paths the title and description
// come from the catch-all [...rest] (src/lib/seo.ts, notFoundMetadata), where this file's metadata does not apply.
export async function generateMetadata(): Promise<Metadata> {
  return notFoundMetadata(await currentLocale());
}

/**
 * Rendered inside the locale layout (header and footer) for notFound() in any page under
 * /[locale], and for unknown paths through the catch-all [locale]/[...rest].
 */
export default async function NotFound() {
  const locale = await currentLocale();
  const t = getDictionary(locale);

  return (
    <PageTransition>
      <section className="container-page py-16 text-center md:py-24">
        <p className="label text-gold-ink">404</p>
        <h1 className="mt-3 font-serif text-5xl text-forest md:text-6xl">{t.notFound.title}</h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted">{t.notFound.text}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={`/${locale}`} className="btn btn-forest">
            {t.notFound.home}
          </Link>
          <Link href={`/${locale}/programs`} className="btn btn-outline text-forest">
            {t.nav.programs}
          </Link>
          <Link href={`/${locale}/menu`} className="btn btn-outline text-forest">
            {t.nav.menu}
          </Link>
        </div>
      </section>
    </PageTransition>
  );
}
