"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { locales, type Locale } from "@/i18n/config";

const LABELS: Record<Locale, string> = { uz: "Oʻz", ru: "Рус" };

export function LocaleSwitch({ current }: { current: Locale }) {
  const pathname = usePathname() ?? `/${current}`;
  const rest = pathname.split("/").slice(2).join("/");

  return (
    <div className="flex items-center gap-1 text-sm">
      {locales.map((locale) => (
        <Link
          key={locale}
          href={`/${locale}${rest ? `/${rest}` : ""}`}
          hrefLang={locale}
          aria-current={locale === current ? "true" : undefined}
          className={`rounded-full px-2.5 py-1 transition-colors ${
            locale === current ? "bg-ivory/15 text-ivory" : "text-ivory/60 hover:text-ivory"
          }`}
        >
          {LABELS[locale]}
        </Link>
      ))}
    </div>
  );
}
