import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarCheck, Carrot, ReceiptText, Wallet } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { requireStockAccess } from "@/lib/admin/auth";
import { formatEntryDay } from "@/lib/admin/finance/month";
import { purchasesHref } from "@/lib/admin/purchase-links";
import { costTrend, formatQuantity, type PurchaseAnalytics } from "@/lib/admin/purchases";
import type { ReportPeriod } from "@/lib/admin/reports";
import { loadPurchaseAnalytics } from "@/lib/admin/stock-queries";
import { localized } from "@/lib/data/localized";
import { BarChart } from "../../kit/BarChart";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { ProgressRow } from "../../kit/ProgressRow";
import { StatTile } from "../../kit/StatTile";

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0);

/**
 * Analytics: what the period's purchases cost. Tiles (spent, average a day, receipts, distinct ingredients, days with
 * purchases), a daily chart, the split by category, payment method and buyer, and the top ingredients with their
 * average and latest unit cost.
 */
export async function AnalyticsTab({ period, locale }: { period: ReportPeriod; locale: Locale }) {
  const { supabase } = await requireStockAccess();
  const t = getAdminDictionary(locale);
  const tp = t.purchases;
  const ta = tp.analytics;

  let data: PurchaseAnalytics | null = null;
  try {
    data = await loadPurchaseAnalytics(supabase, period);
  } catch (error) {
    console.error("purchases analytics failed", error instanceof Error ? error.message : error);
  }
  if (!data) {
    return (
      <Notice tone="negative" retry={{ href: purchasesHref({ tab: "analytics", period }), label: t.common.retry }}>
        {ta.loadFailed}
      </Notice>
    );
  }
  if (data.receipts === 0) {
    return (
      <Panel>
        <EmptyState
          icon={ReceiptText}
          action={
            <Link href="/purchases" className="adm-btn adm-btn-outline">
              {tp.history.addFirst}
            </Link>
          }
        >
          {ta.empty}
        </EmptyState>
      </Panel>
    );
  }

  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;
  const perDay = data.days > 0 ? Math.round(data.total / data.days) : null;
  const max = Math.max(0, ...data.byDay.map((d) => d.amount));
  // Axis labels: about six along the period.
  const step = Math.max(1, Math.ceil(data.byDay.length / 6));
  const unitLabel = (unit: keyof typeof t.ingredients.units) => t.ingredients.units[unit];
  const perUnit = (value: number, unit: keyof typeof t.ingredients.units) => t.ingredients.priceText(sum(value), unitLabel(unit));

  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile label={ta.total} value={sum(data.total)} icon={Wallet} />
        <StatTile
          label={ta.perDay}
          value={perDay === null ? "—" : sum(perDay)}
          icon={CalendarCheck}
          footer={ta.perDayOf(data.days)}
        />
        <StatTile label={ta.receipts} value={formatSum(data.receipts)} icon={ReceiptText} />
        <StatTile label={ta.ingredients} value={formatSum(data.ingredients)} icon={Carrot} />
        <StatTile
          label={ta.daysWith}
          value={ta.daysWithOf(data.daysWithPurchases, data.days)}
          icon={CalendarCheck}
        />
      </div>

      <Panel title={ta.chartTitle}>
        <BarChart
          caption={ta.chartCaption}
          headers={ta.chartHeaders}
          maxLabel={max > 0 ? ta.chartMax(sum(max)) : undefined}
          bars={data.byDay.map((d, i) => ({
            key: d.day,
            value: d.amount,
            display: sum(d.amount),
            label: formatEntryDay(d.day, locale),
            axis: i % step === 0 ? d.day.slice(8).replace(/^0/, "") : undefined,
            current: d.day === period.to,
          }))}
        />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={ta.byCategory}>
          <div className="grid gap-4">
            {data.byCategory.map((row) => (
              <ProgressRow
                key={row.id}
                label={localized(row, "name", locale)}
                value={sum(row.amount)}
                share={share(row.amount, data.total)}
                detail={<span>{ta.share(pct(row.amount, data.total))}</span>}
              />
            ))}
          </div>
        </Panel>
        <Panel title={ta.byMethod}>
          <div className="grid gap-4">
            {data.byMethod.map((row) => (
              <ProgressRow
                key={row.method ?? "none"}
                label={row.method ? t.finance.methods[row.method] : "—"}
                value={sum(row.amount)}
                share={share(row.amount, data.total)}
                tone="info"
                detail={
                  <>
                    <span>{ta.receiptsCount(row.receipts)}</span>
                    <span>{ta.share(pct(row.amount, data.total))}</span>
                  </>
                }
              />
            ))}
          </div>
        </Panel>
        <Panel title={ta.byBuyer}>
          <div className="grid gap-4">
            {data.byBuyer.map((row) => (
              <ProgressRow
                key={row.name || "-"}
                label={row.name || ta.noBuyer}
                value={sum(row.amount)}
                share={share(row.amount, data.total)}
                tone="neutral"
                detail={
                  <>
                    <span>{ta.receiptsCount(row.receipts)}</span>
                    <span>{ta.share(pct(row.amount, data.total))}</span>
                  </>
                }
              />
            ))}
          </div>
        </Panel>
      </div>

      <Panel title={ta.top} description={ta.topLead} flush className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead className="adm-table-head">
            <tr>
              <th className="px-4 py-2.5 font-medium">{ta.columns.name}</th>
              <th className="px-4 py-2.5 text-right font-medium">{ta.columns.quantity}</th>
              <th className="px-4 py-2.5 text-right font-medium">{ta.columns.amount}</th>
              <th className="px-4 py-2.5 text-right font-medium">{ta.columns.avg}</th>
              <th className="px-4 py-2.5 text-right font-medium">{ta.columns.latest}</th>
            </tr>
          </thead>
          <tbody>
            {data.top.map((row) => {
              const trend = costTrend(row.latestCost, row.avgCost);
              const Icon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : ArrowRight;
              const tone =
                trend === "up" ? "text-adm-caution" : trend === "down" ? "text-adm-positive" : "text-adm-muted";
              return (
                <tr key={`${row.ingredientId}:${row.unit}`} className="adm-row">
                  <td className="px-4 py-3">
                    <Link href={`/ingredients/${row.ingredientId}`} className="font-semibold text-adm-text hover:underline">
                      {localized(row, "name", locale)}
                    </Link>
                    {row.usualPrice !== null && (
                      <span className="adm-caption block">{ta.usual(perUnit(row.usualPrice, row.unit))}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {formatQuantity(row.milli, locale)} {unitLabel(row.unit)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{sum(row.amount)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {row.avgCost === null ? "—" : perUnit(row.avgCost, row.unit)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      {row.latestCost === null ? "—" : perUnit(row.latestCost, row.unit)}
                      {trend && (
                        <span className={tone} title={ta.trend[trend]}>
                          <Icon aria-hidden="true" className="size-4" />
                          <span className="sr-only">{ta.trend[trend]}</span>
                        </span>
                      )}
                    </span>
                    {row.latestDay && <span className="adm-caption block">{formatEntryDay(row.latestDay, locale)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
