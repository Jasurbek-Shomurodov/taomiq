import type { NextRequest } from "next/server";
import { defaultAdminLocale, getAdminDictionary } from "@/i18n/admin";
import { htmlLang, type Locale } from "@/i18n/config";
import { ownerSessionOrNull } from "@/lib/admin/auth";
import { EXPORT_ENTRIES_CAP, listEntriesBetween, loadPayroll, loadPayrollExport } from "@/lib/admin/finance/queries";
import {
  loadAllReportOrders,
  loadDurationsReport,
  loadOverviewReport,
  loadPaymentMethodsReport,
  loadProgramsReport,
  loadRenewalsReport,
  loadSourcesReport,
  loadStaffReport,
  loadTimeReport,
} from "@/lib/admin/report-queries";
import { isExportKind, resolveReportPeriod, type ExportKind } from "@/lib/admin/reports";
import { tashkentDay } from "@/lib/admin/stats";
import { financeWorkbook, ordersWorkbook, payrollWorkbook, reportsWorkbook } from "./workbook";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Never stored by a browser or a CDN: the file is the owner's figures. */
const PRIVATE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * What the owner sees instead of a file when there is none to give: a small self-contained page in the panel language
 * (a title, one sentence, a link back to Reports), with the status. The Excel links carry no `download` attribute, so
 * the browser shows this page rather than saving it as a file. No scripts, no outside resources, never cached.
 */
function errorPage(status: number, locale: Locale, kind: "forbidden" | "badRequest" | "failed"): Response {
  const e = getAdminDictionary(locale).reports.exportError;
  const html = `<!doctype html>
<html lang="${htmlLang[locale]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(e.title)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f3ea; --fg: #1d2723; --muted: #5d6762; --accent: #1f5a43; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111815; --fg: #e8ece9; --muted: #a3aea8; --accent: #8ccbb0; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 28rem; padding: 24px 16px; }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { margin: 0 0 20px; color: var(--muted); }
  a { color: var(--accent); font-weight: 600; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(e.title)}</h1>
<p>${escapeHtml(e[kind])}</p>
<a href="/reports">${escapeHtml(e.back)}</a>
</main>
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: { ...PRIVATE_HEADERS, "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
  });
}

/**
 * The Excel export (docs/plans/zarkebab-feature-port.md, slice 5), served as admin.taomiq.uz/reports/export (the proxy
 * rewrites every admin-host path under /admin). One workbook per request:
 *   ?what=reports   every report of the period, a sheet per tab
 *   ?what=finance   the ledger records of the period
 *   ?what=payroll   everyone with their balance on the period's last day, every rate, the period's payments and events
 *   ?what=orders    the order history of the period (never a customer's name, phone or address)
 * and the period exactly as the Reports page reads it (resolveReportPeriod: a preset, or from–to; no period means the
 * last 30 days). An unknown `what` or a period that is not allowed is a 400 page, not a file of another period. A route
 * handler passes through neither the panel layout nor a page's requireOwner(), so it checks the owner
 * itself (a 403 page for anyone else, signed in or not); every read goes through the owner's session, where RLS and the
 * report functions refuse anyone else too. Nothing is cached.
 */
export async function GET(request: NextRequest) {
  const session = await ownerSessionOrNull();
  // Nobody is known to be signed in: the panel's default language.
  if (!session) return errorPage(403, defaultAdminLocale, "forbidden");
  const { supabase, staff } = session;
  const t = getAdminDictionary(staff.locale);

  const params = request.nextUrl.searchParams;
  const whatParam = params.get("what");
  if (!isExportKind(whatParam)) return errorPage(400, staff.locale, "badRequest");
  const what: ExportKind = whatParam;
  // Read the clock only after the session (a request-time read).
  const now = new Date();
  const today = tashkentDay(now)!;
  const period = resolveReportPeriod(
    { period: params.get("period"), from: params.get("from"), to: params.get("to") },
    today,
  );
  // The page shows the last 30 days for a period it cannot take, and says so; a file would say nothing, so a period
  // that is not allowed is refused here instead of silently becoming another one.
  if (period.fellBack) return errorPage(400, staff.locale, "badRequest");
  const { from, to } = period;

  try {
    let book;
    if (what === "reports") {
      const [overview, programs, durations, time, sources, payments, renewals, staffReport, orders] = await Promise.all([
        loadOverviewReport(supabase, from, to),
        loadProgramsReport(supabase, from, to),
        loadDurationsReport(supabase, from, to),
        loadTimeReport(supabase, from, to),
        loadSourcesReport(supabase, from, to),
        loadPaymentMethodsReport(supabase, from, to),
        loadRenewalsReport(supabase, from, to),
        loadStaffReport(supabase, from, to),
        loadAllReportOrders(supabase, from, to, now),
      ]);
      book = reportsWorkbook(
        { overview, programs, durations, time, sources, payments, renewals, staff: staffReport, orders },
        period,
        t,
        now,
      );
    } else if (what === "orders") {
      book = ordersWorkbook(await loadAllReportOrders(supabase, from, to, now), period, t, now);
    } else if (what === "finance") {
      book = financeWorkbook(await listEntriesBetween(supabase, from, to, null, EXPORT_ENTRIES_CAP), period, t, now);
    } else {
      const [people, history] = await Promise.all([loadPayroll(supabase, to), loadPayrollExport(supabase, from, to)]);
      book = payrollWorkbook({ people, ...history }, period, t, now, to);
    }

    const buffer = await book.xlsx.writeBuffer();
    // An ASCII name (what and the days), so every browser keeps it as given.
    const name = `taomiq-${what}-${from}_${to}.xlsx`;
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": XLSX,
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (error) {
    // Codes and messages only: no figures, no personal data in the log.
    console.error(`reports export (${what}) failed`, error instanceof Error ? error.message : error);
    return errorPage(500, staff.locale, "failed");
  }
}
