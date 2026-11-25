import { UserRound } from "lucide-react";
import { getAdminDictionary } from "@/i18n/admin";
import { requireOwner } from "@/lib/admin/auth";
import { loadStaffReport } from "@/lib/admin/report-queries";
import type { StaffReport } from "@/lib/admin/reports";
import { Badge } from "../../kit/Badge";
import { Panel } from "../../kit/Panel";
import { ReportEmpty, ReportFailed, ReportLabeled, type TabProps } from "./parts";

/**
 * Staff: per team member, the orders they added by hand in the period (and how many are paid now) and the status moves
 * they made (report_staff, from the order history). Names only.
 */
export async function StaffTab({ period, locale }: TabProps) {
  const { supabase } = await requireOwner();
  let report: StaffReport | null = null;
  try {
    report = await loadStaffReport(supabase, period.from, period.to);
  } catch (error) {
    console.error("reports staff failed", error instanceof Error ? error.message : error);
  }
  if (!report) return <ReportFailed tab="staff" period={period} locale={locale} />;

  const s = getAdminDictionary(locale).reports.staff;
  if (report.rows.length === 0) {
    return (
      <ReportEmpty tab="staff" period={period} locale={locale}>
        {s.empty}
      </ReportEmpty>
    );
  }

  return (
    <Panel flush title={<ReportLabeled topic="staff" locale={locale}>{s.title}</ReportLabeled>} description={s.lead}>
      <ul>
        {report.rows.map((row, i) => (
          <li key={`${row.name}-${i}`} className="adm-row flex items-start gap-3 px-4 py-3 sm:px-5">
            <span className="adm-tone-neutral mt-0.5 grid size-9 shrink-0 place-items-center rounded-adm-control">
              <UserRound aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-adm-text">
                <span className="break-words">{row.name || s.noName}</span>
                {!row.in_team && <Badge tone="neutral">{s.former}</Badge>}
              </p>
              {row.added > 0 && <p className="adm-caption tabular-nums">{s.added(row.added, row.added_paid)}</p>}
              {row.moves > 0 && (
                <p className="adm-caption tabular-nums">{s.moves(row.moves, row.to_paid, row.to_cancelled)}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
