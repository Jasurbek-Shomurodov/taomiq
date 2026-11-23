"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { htmlLang, localeLabel, localeName, locales, type Locale } from "@/i18n/config";

export function LocaleSwitch({ current }: { current: Locale }) {
  const pathname = usePathname() ?? `/${current}`;
  const rest = pathname.split("/").slice(2).join("/");

  // Keep the query string (the chosen menu day, the plan picked for an order) when the language
  // changes. It is read just before a link is used, not during render: useSearchParams would need a
  // Suspense boundary in the header of every prerendered page, and the server HTML stays query-free.
  const [search, setSearch] = useState("");
  const syncSearch = () => setSearch(window.location.search);

  return (
    <div className="flex items-center gap-0.5 text-sm">
      {locales.map((locale) => (
        <Link
          key={locale}
          href={`/${locale}${rest ? `/${rest}` : ""}${search}`}
          onPointerDown={syncSearch}
          onFocus={syncSearch}
          hrefLang={htmlLang[locale]}
          lang={htmlLang[locale]}
          aria-label={localeName[locale]}
          aria-current={locale === current ? "true" : undefined}
          className={`press inline-flex min-h-10 min-w-10 items-center justify-center rounded-full px-2.5 ${
            locale === current ? "bg-ivory/15 text-ivory" : "text-ivory/60 hover:text-ivory"
          }`}
        >
          {localeLabel[locale]}
        </Link>
      ))}
    </div>
  );
}
