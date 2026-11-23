import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { site } from "@/lib/site";
import { Logo } from "./Logo";
import { LocaleSwitch } from "./LocaleSwitch";

export function Header({ locale, t }: { locale: Locale; t: Dictionary }) {
  const links = [
    { href: `/${locale}#programs`, label: t.nav.programs },
    { href: `/${locale}/menu`, label: t.nav.menu },
    { href: `/${locale}#how`, label: t.nav.how },
    { href: `/${locale}#faq`, label: t.nav.faq },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-ivory/10 bg-forest/95 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href={`/${locale}`} className="text-xl">
          <Logo onDark />
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-ivory/80 md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-ivory">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <LocaleSwitch current={locale} />
          <Link href={`/${locale}/order`} className="btn btn-gold hidden !px-5 !py-2.5 !text-sm sm:inline-flex">
            {t.nav.cta}
          </Link>
        </div>
      </div>

      {/* Mobile: section links in one scrollable row */}
      <nav className="container-page flex gap-5 overflow-x-auto pb-3 text-sm text-ivory/80 md:hidden">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="whitespace-nowrap">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function Footer({ locale, t }: { locale: Locale; t: Dictionary }) {
  return (
    <footer className="bg-forest-deep text-ivory/70">
      <div className="container-page grid gap-8 py-12 md:grid-cols-3">
        <div>
          <Logo onDark className="text-2xl" />
          <p className="label mt-3 text-gold">Premium daily nutrition</p>
          <p className="mt-3 text-sm">{t.footer.tagline}</p>
        </div>
        <nav className="flex flex-col gap-2 text-sm">
          <Link href={`/${locale}#programs`} className="hover:text-ivory">{t.nav.programs}</Link>
          <Link href={`/${locale}/menu`} className="hover:text-ivory">{t.nav.menu}</Link>
          <Link href={`/${locale}#faq`} className="hover:text-ivory">{t.nav.faq}</Link>
        </nav>
        <div className="flex flex-col gap-2 text-sm">
          <a href={site.telegram} className="hover:text-ivory" rel="noopener">Telegram</a>
          <a href={site.instagram} className="hover:text-ivory" rel="noopener">Instagram · @taom_iq</a>
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
