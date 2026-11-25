import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { loadPaymentMethodsReport } from "@/lib/admin/report-queries";
import { PAYMENT_ROW_ORDER, shareOf, type PaymentMethodRow, type PaymentMethodsReport } from "@/lib/admin/reports";
import type { Tone } from "../../kit/Badge";
import { formatPercent } from "../../kit/ChangeBadge";
import { Panel } from "../../kit/Panel";
import { ProgressRow, TONE_FILL } from "../../kit/ProgressRow";
import { DASH, sumText } from "../finance/figures";
import { ReportEmpty, ReportFailed, ReportLabeled, type TabProps } from "./parts";

/** One colour per method, the same on the stacked bar and the rows. */
export const METHOD_TONES: Record<string, Tone> = { cash: "positive", card: "info", transfer: "accent", none: "neutral" };

const toneOf = (row: PaymentMethodRow) => METHOD_TONES[row.method ?? "none"];

/** The method rows in display order (cash, card, transfer, not recorded), only those with orders. */
export function orderedMethodRows(report: PaymentMethodsReport): PaymentMethodRow[] {
  return PAYMENT_ROW_ORDER.flatMap((method) => report.rows.filter((row) => row.method === method && row.orders > 0));
}

/**
 * The split itself, a stacked bar and a row per method: shared by the Payments tab and the overview's owner block.
 * Shares are of revenue. The "not recorded" row carries its "?".
 */
export function PaymentSplit({ report, locale, t }: { report: PaymentMethodsReport; locale: Locale; t: AdminDictionary }) {
  const p = t.reports.payments;
  const rows = orderedMethodRows(report);
  const percent = (part: number) => {
    const share = shareOf(part, report.revenue);
    return share === null ? DASH : formatPercent(share, locale);
  };
  return (
    <>
      <div aria-hidden="true" className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-adm-surface-muted">
        {rows
          .filter((row) => row.revenue > 0)
          .map((row) => (
            <span
              key={row.method ?? "none"}
              className={TONE_FILL[toneOf(row)]}
              style={{ width: `${(shareOf(row.revenue, report.revenue) ?? 0) * 100}%` }}
            />
          ))}
      </div>
      <div className="mt-4 grid gap-4">
        {rows.map((row) => (
          <ProgressRow
            key={row.method ?? "none"}
            tone={toneOf(row)}
            label={
              row.method ? (
                t.finance.methods[row.method]
              ) : (
                <ReportLabeled topic="notRecorded" locale={locale}>
                  {p.notRecorded}
                </ReportLabeled>
              )
            }
            value={sumText(row.revenue, t)}
            share={shareOf(row.revenue, report.revenue) ?? 0}
            detail={<span>{p.line(row.orders, percent(row.revenue))}</span>}
          />
        ))}
      </div>
    </>
  );
}

/** Payments: paid orders and revenue per payment method (report_payment_methods). */
export async function PaymentsTab({ period, locale }: TabProps) {
  const { supabase } = await requireOwner();
  let report: PaymentMethodsReport | null = null;
  try {
    report = await loadPaymentMethodsReport(supabase, period.from, period.to);
  } catch (error) {
    console.error("reports payment methods failed", error instanceof Error ? error.message : error);
  }
  if (!report) return <ReportFailed tab="payments" period={period} locale={locale} />;
  if (report.orders === 0) return <ReportEmpty tab="payments" period={period} locale={locale} />;

  const t = getAdminDictionary(locale);
  const p = t.reports.payments;
  const hasUnrecorded = report.rows.some((row) => row.method === null && row.orders > 0);

  return (
    <>
      <Panel title={p.title} description={p.lead}>
        <PaymentSplit report={report} locale={locale} t={t} />
      </Panel>
      {hasUnrecorded && <p className="adm-caption">{p.notRecordedNote}</p>}
    </>
  );
}
