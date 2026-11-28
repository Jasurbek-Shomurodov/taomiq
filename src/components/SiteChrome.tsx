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
  const link = (path: string, label: string): NavLink => ({ href: `/${locale}${path}`, label, section: `/${locale}${path}` });
  // The desktop row: five links, so it fits at lg in every language. Questions live in the sheet and the footer.
  const links: NavLink[] = [
    link("/programs", t.nav.programs),
    link("/menu", t.nav.menu),
    link("/prices", t.nav.prices),
    link("/calculator", t.nav.calculator),
    link("/delivery", t.nav.delivery),
  ];
  // The phone and tablet sheet: the same sections, plus the program finder after the calculator, and Questions.
  const sheetLinks: NavLink[] = [
    ...links.slice(0, 4),
    link("/quiz", t.quiz.short),
    ...links.slice(4),
    link("/faq", t.nav.faq),
  ];

  const accountLabels = { login: t.account.login, account: t.account.account };

  // .site-header: named in view transitions, so it stays still while the page changes (globals.css).
  return (
    <header className="site-header sticky top-0 z-40 border-b border-ivory/10 bg-forest/95 backdrop-blur">
      {/* One row: 56 px on phones and tablets (sections in the MobileNav sheet), 64 px from lg. */}
      <div className="container-page flex h-14 items-center justify-between gap-3 lg:h-16 lg:gap-4">
        <Link href={`/${locale}`} className="inline-flex min-h-11 items-center text-xl">
          <Lockup layout="inline" markSize={34} />
        </Link>

        <nav aria-label={t.nav.sections} className="hidden items-center gap-7 text-sm text-ivory/80 lg:flex">
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
          <Link href={`/${locale}/order`} className="btn btn-gold hidden min-h-11 !px-5 !py-2.5 !text-sm sm:inline-flex">
            {t.nav.cta}
          </Link>
          <MobileNav
            locale={locale}
            links={sheetLinks}
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

/**
 * Footer link rows: on phones and tablets each link is a 44 px tap target and the rows close up to keep about the
 * same rhythm (gap 0 instead of 8 px); from md the compact 20 px lines with an 8 px gap as before.
 */
const FOOTER_LIST = "flex flex-col max-md:gap-0 md:gap-2";
const FOOTER_LINK = "link self-start hover:text-ivory max-md:min-h-11 max-md:py-3";

export function Footer({
  locale,
  t,
  programs,
}: {
  locale: Locale;
  t: Dictionary;
  /** Program pages to link (from the catalogue); without them the column is only its link to /programs. */
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
          <nav aria-label={t.nav.programs} className={FOOTER_LIST}>
            <Link href={`/${locale}/programs`} className={`label ${FOOTER_LINK} text-ivory/60`}>{t.nav.programs}</Link>
            {programs.map((program) => (
              <Link key={program.slug} href={`/${locale}/programs/${program.slug}`} className={FOOTER_LINK}>
                {program.name}
              </Link>
            ))}
          </nav>
          <nav aria-label={t.goals.label} className={FOOTER_LIST}>
            <p className="label text-ivory/60">{t.goals.label}</p>
            {GOAL_PAGES.map((goal) => (
              <Link key={goal} href={`/${locale}/goals/${goal}`} className={FOOTER_LINK}>
                {t.goals.pages[goal].short}
              </Link>
            ))}
          </nav>
        </div>
        <nav aria-label={t.footer.nav} className={`${FOOTER_LIST} text-sm`}>
          <Link href={`/${locale}/menu`} className={FOOTER_LINK}>{t.nav.menu}</Link>
          <Link href={`/${locale}/prices`} className={FOOTER_LINK}>{t.nav.prices}</Link>
          <Link href={`/${locale}/calculator`} className={FOOTER_LINK}>{t.nav.calculator}</Link>
          <Link href={`/${locale}/quiz`} className={FOOTER_LINK}>{t.quiz.short}</Link>
          <Link href={`/${locale}/delivery`} className={FOOTER_LINK}>{t.nav.delivery}</Link>
          <Link href={`/${locale}#how`} className={FOOTER_LINK}>{t.nav.how}</Link>
          <Link href={`/${locale}/faq`} className={FOOTER_LINK}>{t.nav.faq}</Link>
        </nav>
        <div className={`col-span-2 ${FOOTER_LIST} text-sm md:col-span-1`}>
          <a href={site.telegram} className={FOOTER_LINK} rel="noopener">Telegram</a>
          <a href={site.instagram} className={FOOTER_LINK} rel="noopener">Instagram · @taom_iq</a>
          <Link href={`/${locale}/privacy`} className={FOOTER_LINK}>{t.footer.privacy}</Link>
          <p className="mt-2 text-xs text-ivory/60">{t.footer.legal}</p>
        </div>
      </div>
      <div className="border-t border-ivory/10">
        <p className="container-page py-5 text-xs text-ivory/60">
          © 2026 TAOMIQ. {t.footer.rights}
        </p>
      </div>
    </footer>
  );
}
