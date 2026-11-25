import { getAdminDictionary } from "@/i18n/admin";
import { requireOwner } from "@/lib/admin/auth";
import { loadSourcesReport } from "@/lib/admin/report-queries";
import { shareOf, type SourceReportRow, type SourcesReport } from "@/lib/admin/reports";
import { formatPercent } from "../../kit/ChangeBadge";
import { Panel } from "../../kit/Panel";
import { ProgressRow } from "../../kit/ProgressRow";
import { DASH, sumText } from "../finance/figures";
import { ReportEmpty, ReportFailed, ReportLabeled, type TabProps } from "./parts";

/** Sources shown by name; the rest are summed into one "other" row. */
const SOURCE_ROWS = 12;

type Row = SourceReportRow & { kind: "source" | "direct" | "staff" | "other" };

/**
 * Sources: per utm_source / ref (direct and staff-added on their own lines), the orders placed in the period, how many
 * of them reached payment, and the period's paid orders and revenue (report_sources). The bar is the share of the
 * period's paid orders, or of the placed ones while nothing was paid.
 */
export async function SourcesTab({ period, locale }: TabProps) {
  const { supabase } = await requireOwner();
  let report: SourcesReport | null = null;
  try {
    report = await loadSourcesReport(supabase, period.from, period.to);
  } catch (error) {
    console.error("reports sources failed", error instanceof Error ? error.message : error);
  }
  if (!report) return <ReportFailed tab="sources" period={period} locale={locale} />;

  const t = getAdminDictionary(locale);
  const s = t.reports.sources;
  if (report.rows.length === 0 && !report.other) {
    return (
      <ReportEmpty tab="sources" period={period} locale={locale}>
        {s.empty}
      </ReportEmpty>
    );
  }

  const tagged: Row[] = report.rows.map((row) => ({
    ...row,
    kind: row.source === null ? "direct" : row.source === "staff" ? "staff" : "source",
  }));
  // Past SOURCE_ROWS, and whatever the function itself summed past its own cap (report.other), one "other" row: the
  // rows always add up to the period's totals.
  const shown = tagged.length > SOURCE_ROWS + 1 || report.other ? tagged.slice(0, SOURCE_ROWS) : tagged;
  const restRows = tagged.slice(shown.length);
  let rows = shown;
  if (restRows.length > 0 || report.other) {
    const start: Row = report.other
      ? { ...report.other, source: null, kind: "other" }
      : { source: null, placed: 0, converted: 0, paid: 0, revenue: 0, kind: "other" };
    const rest = restRows.reduce(
      (sum, row) => ({
        ...sum,
        placed: sum.placed + row.placed,
        converted: sum.converted + row.converted,
        paid: sum.paid + row.paid,
        revenue: sum.revenue + row.revenue,
      }),
      start,
    );
    rows = [...shown, rest];
  }

  const paidTotal = rows.reduce((sum, row) => sum + row.paid, 0);
  const placedTotal = rows.reduce((sum, row) => sum + row.placed, 0);
  const share = (row: Row) => (paidTotal > 0 ? shareOf(row.paid, paidTotal) : shareOf(row.placed, placedTotal)) ?? 0;
  const label = (row: Row) =>
    row.kind === "direct" ? s.direct : row.kind === "staff" ? s.staff : row.kind === "other" ? t.home.otherSources : row.source;

  return (
    <Panel title={s.title} description={s.lead}>
      <p className="adm-caption mb-4">
        <ReportLabeled topic="conversion" locale={locale}>
          {s.totals(placedTotal, paidTotal)}
        </ReportLabeled>
      </p>
      <div className="grid gap-4">
        {rows.map((row) => {
          const conversion = shareOf(row.converted, row.placed);
          return (
            <ProgressRow
              key={row.kind === "source" ? `src:${row.source}` : `__${row.kind}`}
              tone={row.kind === "source" ? "info" : row.kind === "staff" ? "accent" : "neutral"}
              label={label(row)}
              value={sumText(row.revenue, t)}
              share={share(row)}
              detail={
                <span>{s.line(row.placed, row.paid, conversion === null ? DASH : formatPercent(conversion, locale))}</span>
              }
            />
          );
        })}
      </div>
    </Panel>
  );
}
