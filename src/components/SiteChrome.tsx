import Link from "next/link";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { site } from "@/lib/site";
import { Lockup } from "./Logo";
import { LocaleSwitch } from "./LocaleSwitch";

export function Header({ locale, t }: { locale: Locale; t: Dictionary }) {
  const links = [
    { href: `/${locale}#programs`, label: t.nav.programs },
    { href: `/${locale}/menu`, label: t.nav.menu },
    { href: `/${locale}/calculator`, label: t.nav.calculator },
    { href: `/${locale}/delivery`, label: t.nav.delivery },
    { href: `/${locale}#faq`, label: t.nav.faq },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-ivory/10 bg-forest/95 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4">
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

        <div className="flex items-center gap-3">
          <LocaleSwitch current={locale} />
          <Link href={`/${locale}/order`} className="btn btn-gold hidden !px-5 !py-2.5 !text-sm sm:inline-flex">
            {t.nav.cta}
          </Link>
        </div>
      </div>

      {/* Phones and tablets: section links in one scrollable row */}
      <nav className="container-page flex gap-5 overflow-x-auto pb-1 text-sm text-ivory/80 lg:hidden">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="inline-flex min-h-10 items-center whitespace-nowrap">
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
          <Link href={`/${locale}`} className="inline-block">
            <Lockup tagline width={208} />
          </Link>
          <p className="mt-5 text-sm">{t.footer.tagline}</p>
        </div>
        <nav className="flex flex-col gap-2 text-sm">
          <Link href={`/${locale}#programs`} className="hover:text-ivory">{t.nav.programs}</Link>
          <Link href={`/${locale}/menu`} className="hover:text-ivory">{t.nav.menu}</Link>
          <Link href={`/${locale}/calculator`} className="hover:text-ivory">{t.nav.calculator}</Link>
          <Link href={`/${locale}/delivery`} className="hover:text-ivory">{t.nav.delivery}</Link>
          <Link href={`/${locale}#how`} className="hover:text-ivory">{t.nav.how}</Link>
          <Link href={`/${locale}#faq`} className="hover:text-ivory">{t.nav.faq}</Link>
        </nav>
        <div className="flex flex-col gap-2 text-sm">
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
