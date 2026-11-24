import { CalendarCheck, ChartColumn, Inbox, ShoppingBag, Wallet } from "lucide-react";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, htmlLang, type Locale } from "@/i18n/config";
import { ORDER_STATUSES } from "@/lib/admin/orders";
import {
  STATS_ROW_CAP,
  loadOrderStats,
  percentChange,
  type OrderStats,
  type OrdersSummary,
  type Tally,
} from "@/lib/admin/stats";
import { Badge } from "../kit/Badge";
import { BarChart, type ChartBar } from "../kit/BarChart";
import { ChangeBadge, formatPercent } from "../kit/ChangeBadge";
import { EmptyState } from "../kit/EmptyState";
import { Notice } from "../kit/Notice";
import { Panel } from "../kit/Panel";
import { ProgressRow, TONE_FILL } from "../kit/ProgressRow";
import { Segmented } from "../kit/Segmented";
import { StatTile } from "../kit/StatTile";
import { ORDER_STATUS_TONES } from "./orders/StatusBadge";

export type ChartMode = "orders" | "value";

const DASH = "—";

/** "YYYY-MM-DD" as a Date at UTC midnight, formatted in UTC: the calendar day as written, in any server zone. */
function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * The owner's order figures: KPI tiles, the 30-day chart, status, program and source breakdowns. Rendered for owners
 * only (the loader returns null for anyone else). A failed count prints "—" in its tile; a failed row read replaces
 * the chart and breakdowns with one notice and leaves the rest of the overview alone.
 */
export async function OrdersOverview({ locale, chart }: { locale: Locale; chart: ChartMode }) {
  const stats = await loadOrderStats();
  if (!stats) return null;
  return <OrdersOverviewView stats={stats} locale={locale} chart={chart} />;
}

/** The figures as markup, from already-loaded stats (no data access). */
export function OrdersOverviewView({ stats, locale, chart }: { stats: OrderStats; locale: Locale; chart: ChartMode }) {
  const t = getAdminDictionary(locale);
  const { summary } = stats;
  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;
  const money = (value: number) => (
    <>
      {formatSum(value)}
      <span className="ml-1.5 text-base font-medium text-adm-muted">{t.common.currency}</span>
    </>
  );
  // Today so far is compared with yesterday up to the same time of day, never with the whole of yesterday.
  const yesterday = (text: string) => <span>{t.home.yesterdaySoFar(text)}</span>;
  const selfHref = chart === "value" ? "/?chart=value" : "/";

  return (
    <>
      {!summary && (
        <Notice tone="negative" retry={{ href: selfHref, label: t.common.retry }}>
          {t.home.ordersFailed}
        </Notice>
      )}
      {stats.partial && <Notice tone="caution">{t.home.partial(formatSum(STATS_ROW_CAP))}</Notice>}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile
          label={t.home.newOrders}
          value={stats.waiting ?? DASH}
          icon={Inbox}
          href="/orders?status=new"
          tone={(stats.waiting ?? 0) > 0 ? "caution" : "accent"}
          footer={
            (stats.waiting ?? 0) > 0 ? (
              <span className="font-medium text-adm-caution">{t.home.waitingHint}</span>
            ) : undefined
          }
        />
        <StatTile
          label={t.home.ordersToday}
          value={summary ? summary.today.orders : DASH}
          icon={ShoppingBag}
          footer={
            <>
              {summary && (
                <ChangeBadge change={percentChange(summary.today.orders, summary.yesterdaySoFar.orders)} locale={locale} />
              )}
              {yesterday(summary ? String(summary.yesterdaySoFar.orders) : DASH)}
            </>
          }
        />
        <StatTile
          label={t.home.valueToday}
          value={summary ? money(summary.today.value) : DASH}
          icon={Wallet}
          footer={
            <>
              {summary && (
                <ChangeBadge change={percentChange(summary.today.value, summary.yesterdaySoFar.value)} locale={locale} />
              )}
              {yesterday(summary ? sum(summary.yesterdaySoFar.value) : DASH)}
            </>
          }
        />
        <StatTile
          label={t.home.activeSubscriptions}
          value={stats.active ?? DASH}
          icon={CalendarCheck}
          href="/orders?status=active"
          footer={<span>{t.home.paidWaiting(stats.paid === null ? DASH : String(stats.paid))}</span>}
        />
      </div>

      {summary && (
        <OrderBreakdowns summary={summary} partial={stats.partial} chart={chart} locale={locale} sum={sum} />
      )}
    </>
  );
}

function OrderBreakdowns({
  summary,
  partial,
  chart,
  locale,
  sum,
}: {
  summary: OrdersSummary;
  partial: boolean;
  chart: ChartMode;
  locale: Locale;
  sum: (value: number) => string;
}) {
  const t = getAdminDictionary(locale);
  const lang = htmlLang[locale];
  const longDay = new Intl.DateTimeFormat(lang, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const shortDay = new Intl.DateTimeFormat(lang, { timeZone: "UTC", day: "2-digit", month: "2-digit" });
  const pick = (tally: Tally) => (chart === "value" ? tally.value : tally.orders);
  const show = (tally: Tally) => (chart === "value" ? sum(tally.value) : String(tally.orders));
  const last = summary.days.length - 1;

  const bars: ChartBar[] = summary.days.map((day, i) => ({
    key: day.day,
    value: pick(day),
    display: show(day),
    label: day.isToday ? `${t.home.today}, ${longDay.format(dayDate(day.day))}` : longDay.format(dayDate(day.day)),
    // Today and every seventh day back from it.
    axis: (last - i) % 7 === 0 ? shortDay.format(dayDate(day.day)) : undefined,
    current: day.isToday,
  }));
  const top = Math.max(0, ...bars.map((bar) => bar.value));
  // Like for like: the period so far against the same stretch 30 days earlier (stats.summarizeOrders). A cut at the
  // row cap drops the oldest days first, which are the comparison period: no change then.
  const periodChange = partial ? null : percentChange(pick(summary.period), pick(summary.previous));

  const chartPanel = (
    <Panel
      title={t.home.chartTitle}
      description={
        <>
          <span className="tabular-nums">
            {t.home.ordersCount(summary.period.orders)} · {sum(summary.period.value)}
          </span>
          {periodChange !== null && (
            <>
              {" "}
              <ChangeBadge change={periodChange} locale={locale} /> {t.home.vsPrevious}
            </>
          )}
        </>
      }
      actions={
        <Segmented
          label={t.home.chartModes}
          value={chart}
          items={[
            { key: "orders", label: t.home.chartOrders, href: "/" },
            { key: "value", label: t.home.chartValue, href: "/?chart=value" },
          ]}
        />
      }
    >
      {summary.period.orders === 0 ? (
        <EmptyState icon={ChartColumn}>{t.home.noOrders}</EmptyState>
      ) : (
        <BarChart
          bars={bars}
          caption={t.home.chartCaption}
          headers={[t.home.chartDay, chart === "value" ? t.home.chartValue : t.home.chartOrders]}
          maxLabel={t.home.chartMax(chart === "value" ? sum(top) : String(top))}
        />
      )}
    </Panel>
  );

  // No orders in the period: the chart panel says so once, without three more empty panels under it.
  if (summary.period.orders === 0) return chartPanel;

  const total = summary.period.orders;
  const statuses = ORDER_STATUSES.map((status) => ({ status, count: summary.byStatus[status] }));

  return (
    <>
      {chartPanel}

      <Panel title={t.home.byStatus} description={t.home.byStatusLead}>
        <div aria-hidden="true" className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-adm-surface-muted">
          {statuses
            .filter(({ count }) => count > 0)
            .map(({ status, count }) => (
              <span
                key={status}
                className={TONE_FILL[ORDER_STATUS_TONES[status]]}
                style={{ width: `${(count / total) * 100}%` }}
              />
            ))}
        </div>
        <ul className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))]">
          {statuses.map(({ status, count }) => (
            <li key={status} className="grid content-start justify-items-start gap-1">
              <Badge status tone={ORDER_STATUS_TONES[status]}>
                {t.orders.tabs[status]}
              </Badge>
              <span className="text-xl font-semibold tabular-nums text-adm-text">{count}</span>
              <span className="adm-caption tabular-nums">{formatPercent(count / total, locale)}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={t.home.byProgram} description={t.home.byProgramLead}>
          <div className="grid gap-4">
            {summary.byProgram.map((row) => (
              <ProgressRow
                key={row.key}
                label={
                  <>
                    {row.name}
                    {row.kcal !== null && (
                      <span className="text-adm-muted">
                        {" "}
                        / {row.kcal} {t.common.kcal}
                      </span>
                    )}
                  </>
                }
                value={t.home.ordersCount(row.orders)}
                share={row.share}
                detail={
                  <>
                    <span>{t.home.share(formatPercent(row.share, locale))}</span>
                    <span className="whitespace-nowrap">{sum(row.value)}</span>
                  </>
                }
              />
            ))}
          </div>
        </Panel>

        <Panel title={t.home.sources} description={t.home.sourcesLead}>
          <div className="grid gap-4">
            {summary.bySource.map((row) => (
              <ProgressRow
                key={row.key}
                tone={row.kind === "source" ? "info" : "neutral"}
                label={
                  row.kind === "source" ? row.label : row.kind === "direct" ? t.home.direct : t.home.otherSources
                }
                value={t.home.ordersCount(row.orders)}
                share={row.share}
                detail={
                  <>
                    <span>{t.home.share(formatPercent(row.share, locale))}</span>
                    <span className="whitespace-nowrap">{sum(row.value)}</span>
                  </>
                }
              />
            ))}
          </div>
        </Panel>
      </div>

      <p className="adm-caption">{t.home.valueNote}</p>
    </>
  );
}
