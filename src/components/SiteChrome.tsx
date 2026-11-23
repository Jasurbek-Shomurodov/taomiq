import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import type { Program } from "@/lib/data/types";
import { GOAL_PAGES } from "@/lib/goal-pages";
import { site } from "@/lib/site";
import { Lockup } from "./Logo";
import { LocaleSwitch } from "./LocaleSwitch";
import { MobileNav } from "./MobileNav";

export function Header({ locale, t }: { locale: Locale; t: Dictionary }) {
  const links = [
    { href: `/${locale}#programs`, label: t.nav.programs },
    { href: `/${locale}/menu`, label: t.nav.menu },
    { href: `/${locale}/calculator`, label: t.nav.calculator },
    { href: `/${locale}/delivery`, label: t.nav.delivery },
    { href: `/${locale}/faq`, label: t.nav.faq },
  ];

  // .site-header: named in view transitions, so it stays still while the page changes (globals.css).
  return (
    <header className="site-header sticky top-0 z-40 border-b border-ivory/10 bg-forest/95 backdrop-blur">
      {/* One row: 56 px on phones and tablets (sections in the MobileNav sheet), 64 px from lg. */}
      <div className="container-page flex h-14 items-center justify-between gap-3 lg:h-16 lg:gap-4">
        <Link href={`/${locale}`} className="text-xl">
          <Lockup layout="inline" markSize={34} />
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-ivory/80 lg:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="inline-flex min-h-11 items-center transition-colors hover:text-ivory">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1 sm:gap-3">
          <LocaleSwitch current={locale} />
          <Link href={`/${locale}/order`} className="btn btn-gold hidden !px-5 !py-2.5 !text-sm sm:inline-flex">
            {t.nav.cta}
          </Link>
          {/* The sheet adds the program finder after the calculator; the desktop row stays at five links. */}
          <MobileNav
            locale={locale}
            links={[...links.slice(0, 3), { href: `/${locale}/quiz`, label: t.quiz.short }, ...links.slice(3)]}
            telegramUrl={site.telegram}
            labels={{ sections: t.nav.sections, close: t.nav.close }}
          />
        </div>
      </div>
    </header>
  );
}

export function Footer({
  locale,
  t,
  programs,
}: {
  locale: Locale;
  t: Dictionary;
  /** Program pages to link (from the catalogue); the column falls back to the home section without them. */
  programs: Pick<Program, "slug" | "name">[];
}) {
  return (
    <footer className="bg-forest-deep text-ivory/70">
      <div className="container-page grid grid-cols-2 gap-8 py-12 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1">
          <Link href={`/${locale}`} className="inline-block">
            <Lockup tagline width={208} />
          </Link>
          <p className="mt-5 text-sm">{t.footer.tagline}</p>
        </div>
        {/* Programs, then the goal pages under them: one column, so the footer stays two columns on phones. */}
        <div className="flex flex-col gap-6 text-sm">
          <nav aria-label={t.nav.programs} className="flex flex-col gap-2">
            <Link href={`/${locale}#programs`} className="label text-ivory/50 hover:text-ivory">{t.nav.programs}</Link>
            {programs.map((program) => (
              <Link key={program.slug} href={`/${locale}/programs/${program.slug}`} className="hover:text-ivory">
                {program.name}
              </Link>
            ))}
          </nav>
          <nav aria-label={t.goals.label} className="flex flex-col gap-2">
            <p className="label text-ivory/50">{t.goals.label}</p>
            {GOAL_PAGES.map((goal) => (
              <Link key={goal} href={`/${locale}/goals/${goal}`} className="hover:text-ivory">
                {t.goals.pages[goal].short}
              </Link>
            ))}
          </nav>
        </div>
        <nav className="flex flex-col gap-2 text-sm">
          <Link href={`/${locale}/menu`} className="hover:text-ivory">{t.nav.menu}</Link>
          <Link href={`/${locale}/prices`} className="hover:text-ivory">{t.nav.prices}</Link>
          <Link href={`/${locale}/calculator`} className="hover:text-ivory">{t.nav.calculator}</Link>
          <Link href={`/${locale}/quiz`} className="hover:text-ivory">{t.quiz.short}</Link>
          <Link href={`/${locale}/delivery`} className="hover:text-ivory">{t.nav.delivery}</Link>
          <Link href={`/${locale}#how`} className="hover:text-ivory">{t.nav.how}</Link>
          <Link href={`/${locale}/faq`} className="hover:text-ivory">{t.nav.faq}</Link>
        </nav>
        <div className="col-span-2 flex flex-col gap-2 text-sm md:col-span-1">
          <a href={site.telegram} className="hover:text-ivory" rel="noopener">Telegram</a>
          <a href={site.instagram} className="hover:text-ivory" rel="noopener">Instagram · @taom_iq</a>
          <Link href={`/${locale}/privacy`} className="hover:text-ivory">{t.footer.privacy}</Link>
          <p className="mt-2 text-xs text-ivory/50">{t.footer.legal}</p>
        </div>
      </div>
      <div className="border-t border-ivory/10">
        <p className="container-page py-5 text-xs text-ivory/50">
          © 2026 TAOMIQ. {t.footer.rights}
        </p>
      </div>
    </footer>
  );
}
