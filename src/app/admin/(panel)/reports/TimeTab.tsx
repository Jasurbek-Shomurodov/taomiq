import { getAdminDictionary } from "@/i18n/admin";
import { requireOwner } from "@/lib/admin/auth";
import { loadTimeReport } from "@/lib/admin/report-queries";
import { hourTotals, timeGrid, weekdayTotals, type TimeReport } from "@/lib/admin/reports";
import { BarChart, type ChartBar } from "../../kit/BarChart";
import { Heatmap } from "../../kit/Heatmap";
import { Panel } from "../../kit/Panel";
import { ReportEmpty, ReportFailed, ReportLabeled, type TabProps } from "./parts";

/** "09": an hour on an axis. */
const hh = (hour: number) => String(hour).padStart(2, "0");

/**
 * Time: when the period's paid orders were placed (report_time), as a weekday × hour heat map, then by weekday and by
 * hour. The busiest cell is written out under the map.
 */
export async function TimeTab({ period, locale }: TabProps) {
  const { supabase } = await requireOwner();
  let report: TimeReport | null = null;
  try {
    report = await loadTimeReport(supabase, period.from, period.to);
  } catch (error) {
    console.error("reports time failed", error instanceof Error ? error.message : error);
  }
  if (!report) return <ReportFailed tab="time" period={period} locale={locale} />;
  if (report.orders === 0) return <ReportEmpty tab="time" period={period} locale={locale} />;

  const tm = getAdminDictionary(locale).reports.time;
  const grid = timeGrid(report);
  const byHour = hourTotals(grid);
  const byWeekday = weekdayTotals(grid);

  let busiest = { row: 0, column: 0, value: 0 };
  grid.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value > busiest.value) busiest = { row: r, column: c, value };
    }),
  );

  const columns = Array.from({ length: 24 }, (_, hour) => ({
    label: tm.hourRange(hour),
    axis: hour % 3 === 0 ? hh(hour) : undefined,
  }));
  const weekdayBars: ChartBar[] = byWeekday.map((value, i) => ({
    key: String(i),
    value,
    display: String(value),
    label: tm.weekdaysLong[i],
    axis: tm.weekdays[i],
  }));
  const hourBars: ChartBar[] = byHour.map((value, hour) => ({
    key: String(hour),
    value,
    display: String(value),
    label: tm.hourRange(hour),
    axis: hour % 3 === 0 ? hh(hour) : undefined,
  }));

  return (
    <>
      <Panel title={<ReportLabeled topic="time" locale={locale}>{tm.title}</ReportLabeled>} description={tm.lead}>
        <Heatmap
          rows={tm.weekdays.map((short, i) => ({ short, long: tm.weekdaysLong[i] }))}
          columns={columns}
          values={grid}
          caption={tm.caption}
          corner={tm.weekday}
          cellLabel={(r, c, value) => tm.cell(tm.weekdays[r], tm.hourRange(c), value)}
          legend={{ less: tm.less, more: tm.more }}
        />
        <p className="adm-caption mt-3">{tm.busiest(tm.weekdaysLong[busiest.row], tm.hourRange(busiest.column))}</p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={tm.byWeekday}>
          <BarChart
            bars={weekdayBars}
            caption={tm.byWeekday}
            headers={[tm.weekday, tm.orders]}
            maxLabel={tm.max(String(Math.max(...byWeekday)))}
          />
        </Panel>
        <Panel title={tm.byHour}>
          <BarChart
            bars={hourBars}
            caption={tm.byHour}
            headers={[tm.hour, tm.orders]}
            maxLabel={tm.max(String(Math.max(...byHour)))}
          />
        </Panel>
      </div>
    </>
  );
}
