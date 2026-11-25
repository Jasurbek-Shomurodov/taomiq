import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { REPORT_TABS, reportsHref, type ReportPeriod, type ReportTab } from "@/lib/admin/reports";

/**
 * The eight report tabs as underlined links (?tab=), each keeping the period: in the top bar and, until the bar fills
 * after hydration, at the top of the page. The open one carries aria-current. A tab change starts the history at page 1.
 */
export function ReportsTabs({ tab, period, locale }: { tab: ReportTab; period: ReportPeriod; locale: Locale }) {
  const r = getAdminDictionary(locale).reports;
  return (
    <nav aria-label={r.tabsAria} className="adm-tabs">
      {REPORT_TABS.map((key) => (
        <Link key={key} href={reportsHref({ tab: key, period })} aria-current={key === tab ? "page" : undefined} scroll={false}>
          {r.tabs[key]}
        </Link>
      ))}
    </nav>
  );
}
