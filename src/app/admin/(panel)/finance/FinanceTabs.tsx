"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { panelPath } from "../../shell/nav";

/** The Finance sections, in order. Payroll and Month close join in later slices of the plan. */
const TABS = [
  { key: "month", href: "/finance" },
  { key: "year", href: "/finance/year" },
  { key: "records", href: "/finance/records" },
] as const;

/**
 * Month · Year · Records, as underlined tabs: in the top bar (finance/layout.tsx) and, until the bar fills after
 * hydration, at the top of each Finance page. The current one carries aria-current. Month is /finance exactly; the
 * others also own their sub-paths.
 */
export function FinanceTabs({ locale }: { locale: Locale }) {
  const t = getAdminDictionary(locale).finance;
  const path = panelPath(usePathname());
  const isCurrent = (href: string) => (href === "/finance" ? path === href : path === href || path.startsWith(`${href}/`));

  return (
    <nav aria-label={t.tabsAria} className="adm-tabs">
      {TABS.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={isCurrent(tab.href) ? "page" : undefined}>
          {t.tabs[tab.key]}
        </Link>
      ))}
    </nav>
  );
}
