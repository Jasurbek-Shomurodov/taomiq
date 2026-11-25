import { CalendarX2, Hourglass, Repeat, Timer } from "lucide-react";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { loadRenewalsReport } from "@/lib/admin/report-queries";
import { renewalRate, type RenewalsReport } from "@/lib/admin/reports";
import { formatPercent } from "../../kit/ChangeBadge";
import { StatTile } from "../../kit/StatTile";
import { DASH } from "../finance/figures";
import { ReportEmpty, ReportFailed, ReportLabeled, type TabProps } from "./parts";

/**
 * Renewals: of the customers whose latest paid plan ended in the period, how many ordered again within 14 days, how
 * long they paused, and how many can still renew (report_renewals).
 */
export async function RenewalsTab({ period, locale }: TabProps) {
  const { supabase } = await requireOwner();
  let report: RenewalsReport | null = null;
  try {
    report = await loadRenewalsReport(supabase, period.from, period.to);
  } catch (error) {
    console.error("reports renewals failed", error instanceof Error ? error.message : error);
  }
  if (!report) return <ReportFailed tab="renewals" period={period} locale={locale} />;

  const r = getAdminDictionary(locale).reports.renewals;
  if (report.ended === 0) {
    return (
      <ReportEmpty tab="renewals" period={period} locale={locale}>
        {r.empty}
      </ReportEmpty>
    );
  }

  const rate = renewalRate(report);
  const decided = report.ended - report.waiting;
  const gap =
    report.avg_gap_days === null
      ? DASH
      : r.gapValue(new Intl.NumberFormat(htmlLang[locale], { maximumFractionDigits: 1 }).format(report.avg_gap_days));

  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile label={r.ended} value={report.ended} icon={CalendarX2} footer={<span>{r.endedHint}</span>} />
        <StatTile
          label={<ReportLabeled topic="renewalRate" locale={locale}>{r.rate}</ReportLabeled>}
          value={rate === null ? DASH : formatPercent(rate, locale)}
          icon={Repeat}
          footer={<span>{r.rateHint(report.renewed, decided)}</span>}
        />
        <StatTile
          label={<ReportLabeled topic="avgGap" locale={locale}>{r.gap}</ReportLabeled>}
          value={gap}
          icon={Timer}
          footer={<span>{r.early(report.early)}</span>}
        />
        <StatTile label={r.waiting} value={report.waiting} icon={Hourglass} footer={<span>{r.waitingHint}</span>} />
      </div>
      <p className="adm-caption">{r.note}</p>
    </>
  );
}
