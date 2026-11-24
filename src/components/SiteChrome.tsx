import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import type { Program } from "@/lib/data/types";
import { GOAL_PAGES } from "@/lib/goal-pages";
import { isAccountEnabled } from "@/lib/account/methods";
import { site } from "@/lib/site";
import { AccountLink } from "./AccountLink";
import { Lockup } from "./Logo";
import { LocaleSwitch } from "./LocaleSwitch";
import { MobileNav } from "./MobileNav";
import { DesktopNavLinks, type NavLink } from "./NavLinks";

export function Header({ locale, t }: { locale: Locale; t: Dictionary }) {
  // section: the path each link owns, for the current-page marker (a program page counts as Programs).
  const links: NavLink[] = [
    { href: `/${locale}#programs`, label: t.nav.programs, section: `/${locale}/programs` },
    { href: `/${locale}/menu`, label: t.nav.menu, section: `/${locale}/menu` },
    { href: `/${locale}/calculator`, label: t.nav.calculator, section: `/${locale}/calculator` },
    { href: `/${locale}/delivery`, label: t.nav.delivery, section: `/${locale}/delivery` },
    { href: `/${locale}/faq`, label: t.nav.faq, section: `/${locale}/faq` },
  ];

  const accountLabels = { login: t.account.login, account: t.account.account };

  // .site-header: named in view transitions, so it stays still while the page changes (globals.css).
  return (
    <header className="site-header sticky top-0 z-40 border-b border-ivory/10 bg-forest/95 backdrop-blur">
      {/* One row: 56 px on phones and tablets (sections in the MobileNav sheet), 64 px from lg. */}
      <div className="container-page flex h-14 items-center justify-between gap-3 lg:h-16 lg:gap-4">
        <Link href={`/${locale}`} className="text-xl">
          <Lockup layout="inline" markSize={34} />
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-ivory/80 lg:flex">
          <DesktopNavLinks links={links} />
        </nav>

        <div className="flex items-center gap-1 sm:gap-3">
          <LocaleSwitch current={locale} />
          {/* Sign-in: only when NEXT_PUBLIC_AUTH_METHODS switches it on. Phones and tablets: in the MobileNav sheet. */}
          {isAccountEnabled && (
            <AccountLink
              locale={locale}
              labels={accountLabels}
              className="hidden min-h-11 items-center gap-2 text-sm text-ivory/80 transition-colors hover:text-ivory lg:inline-flex"
            />
          )}
          <Link href={`/${locale}/order`} className="btn btn-gold hidden !px-5 !py-2.5 !text-sm sm:inline-flex">
            {t.nav.cta}
          </Link>
          {/* The sheet adds the program finder after the calculator; the desktop row stays at five links. */}
          <MobileNav
            locale={locale}
            links={[...links.slice(0, 3), { href: `/${locale}/quiz`, label: t.quiz.short, section: `/${locale}/quiz` }, ...links.slice(3)]}
            telegramUrl={site.telegram}
            labels={{ sections: t.nav.sections, close: t.nav.close }}
            account={
              isAccountEnabled ? (
                <AccountLink
                  locale={locale}
                  labels={accountLabels}
                  className="inline-flex min-h-11 items-center gap-2 text-sm text-ivory/80 hover:text-ivory"
                />
              ) : null
            }
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
            <Link href={`/${locale}#programs`} className="label link self-start text-ivory/50 hover:text-ivory">{t.nav.programs}</Link>
            {programs.map((program) => (
              <Link key={program.slug} href={`/${locale}/programs/${program.slug}`} className="link self-start hover:text-ivory">
                {program.name}
              </Link>
            ))}
          </nav>
          <nav aria-label={t.goals.label} className="flex flex-col gap-2">
            <p className="label text-ivory/50">{t.goals.label}</p>
            {GOAL_PAGES.map((goal) => (
              <Link key={goal} href={`/${locale}/goals/${goal}`} className="link self-start hover:text-ivory">
                {t.goals.pages[goal].short}
              </Link>
            ))}
          </nav>
        </div>
        <nav className="flex flex-col gap-2 text-sm">
          <Link href={`/${locale}/menu`} className="link self-start hover:text-ivory">{t.nav.menu}</Link>
          <Link href={`/${locale}/prices`} className="link self-start hover:text-ivory">{t.nav.prices}</Link>
          <Link href={`/${locale}/calculator`} className="link self-start hover:text-ivory">{t.nav.calculator}</Link>
          <Link href={`/${locale}/quiz`} className="link self-start hover:text-ivory">{t.quiz.short}</Link>
          <Link href={`/${locale}/delivery`} className="link self-start hover:text-ivory">{t.nav.delivery}</Link>
          <Link href={`/${locale}#how`} className="link self-start hover:text-ivory">{t.nav.how}</Link>
          <Link href={`/${locale}/faq`} className="link self-start hover:text-ivory">{t.nav.faq}</Link>
        </nav>
        <div className="col-span-2 flex flex-col gap-2 text-sm md:col-span-1">
          <a href={site.telegram} className="link self-start hover:text-ivory" rel="noopener">Telegram</a>
          <a href={site.instagram} className="link self-start hover:text-ivory" rel="noopener">Instagram · @taom_iq</a>
          <Link href={`/${locale}/privacy`} className="link self-start hover:text-ivory">{t.footer.privacy}</Link>
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
