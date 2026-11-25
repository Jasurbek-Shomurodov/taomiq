import { CalendarRange, Tags } from "lucide-react";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { loadDurationsReport, loadProgramsReport } from "@/lib/admin/report-queries";
import { shareOf, type DurationsReport, type ProgramsReport } from "@/lib/admin/reports";
import { formatPercent } from "../../kit/ChangeBadge";
import { EmptyState } from "../../kit/EmptyState";
import { Panel } from "../../kit/Panel";
import { ProgressRow } from "../../kit/ProgressRow";
import { DASH, sumText } from "../finance/figures";
import { ReportEmpty, ReportFailed, type TabProps } from "./parts";

/**
 * Programs: revenue, orders and ration-days per program and calorie level (report_programs), then per plan length and
 * per schedule (report_durations). Shares are of the period's revenue.
 */
export async function ProgramsTab({ period, locale }: TabProps) {
  const { supabase } = await requireOwner();
  const [programs, durations] = await Promise.all([
    loadProgramsReport(supabase, period.from, period.to).catch((error: unknown): ProgramsReport | null => {
      console.error("reports programs failed", error instanceof Error ? error.message : error);
      return null;
    }),
    loadDurationsReport(supabase, period.from, period.to).catch((error: unknown): DurationsReport | null => {
      console.error("reports durations failed", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);
  if (!programs || !durations) return <ReportFailed tab="programs" period={period} locale={locale} />;
  if (programs.orders === 0) return <ReportEmpty tab="programs" period={period} locale={locale} />;

  const t = getAdminDictionary(locale);
  const p = t.reports.programs;
  const total = programs.revenue;
  const percent = (part: number) => {
    const share = shareOf(part, total);
    return share === null ? DASH : formatPercent(share, locale);
  };

  return (
    <>
      <Panel title={p.title} description={p.lead}>
        <div className="grid gap-4">
          {programs.rows.map((row) => (
            <ProgressRow
              key={`${row.program_id ?? row.program_name}-${row.kcal ?? ""}`}
              label={
                <>
                  {row.program_name}
                  {row.kcal !== null && (
                    <span className="text-adm-muted">
                      {" "}
                      / {row.kcal} {t.common.kcal}
                    </span>
                  )}
                </>
              }
              value={sumText(row.revenue, t)}
              share={shareOf(row.revenue, total) ?? 0}
              detail={<span>{p.line(row.orders, formatSum(row.ration_days), percent(row.revenue))}</span>}
            />
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={p.durationsTitle} description={p.durationsLead}>
          {durations.by_days.length === 0 ? (
            <EmptyState icon={CalendarRange}>{t.reports.emptyPeriod}</EmptyState>
          ) : (
            <div className="grid gap-4">
              {durations.by_days.map((row) => (
                <ProgressRow
                  key={row.days}
                  label={p.durationLabel(row.days)}
                  value={sumText(row.revenue, t)}
                  share={shareOf(row.revenue, total) ?? 0}
                  tone="info"
                  detail={<span>{p.ordersLine(row.orders, percent(row.revenue))}</span>}
                />
              ))}
            </div>
          )}
        </Panel>
        <Panel title={p.scheduleTitle} description={p.scheduleLead}>
          {durations.by_schedule.length === 0 ? (
            <EmptyState icon={Tags}>{t.reports.emptyPeriod}</EmptyState>
          ) : (
            <div className="grid gap-4">
              {durations.by_schedule.map((row) => (
                <ProgressRow
                  key={String(row.weekdays_only)}
                  label={row.weekdays_only ? p.weekdaysOnly : p.everyDay}
                  value={sumText(row.revenue, t)}
                  share={shareOf(row.revenue, total) ?? 0}
                  tone="neutral"
                  detail={<span>{p.ordersLine(row.orders, percent(row.revenue))}</span>}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
