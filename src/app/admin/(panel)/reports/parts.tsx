import { ChartColumn, FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { exportHref, reportsHref, type ExportKind, type ReportPeriod, type ReportTab } from "@/lib/admin/reports";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { HelpButton } from "../finance/HelpButton";

/* Shared pieces of the Reports tabs: the "?" explainers, the Excel link, the failed and empty states. No data access. */

export type ReportHelpTopic = keyof AdminDictionary["reports"]["help"];

/** What every tab gets from the page. */
export type TabProps = { period: ReportPeriod; locale: Locale };

/** The "?" for a report figure, in the reader's language (the finance screens' dialog). */
export function ReportHelp({ topic, locale }: { topic: ReportHelpTopic; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const text = t.reports.help[topic];
  return <HelpButton title={text.title} body={text.body} label={t.finance.helpAria(text.title)} close={t.finance.helpClose} />;
}

/** A caption with its "?" beside it. */
export function ReportLabeled({ children, topic, locale }: { children: ReactNode; topic: ReportHelpTopic; locale: Locale }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <ReportHelp topic={topic} locale={locale} />
    </span>
  );
}

/**
 * The Excel download: a plain link (the response is a file, never a client navigation), outlined so it never competes
 * with a page's one primary button. No `download` attribute: the route itself sends Content-Disposition: attachment for
 * a file, and an error comes back as a page the owner can read instead of a saved file. `what` names the file in the accessible name ("Скачать в Excel: записи за ноябрь").
 */
export function ExcelLink({
  kind,
  period,
  what,
  locale,
  small = false,
}: {
  kind: ExportKind;
  period: Pick<ReportPeriod, "from" | "to" | "preset">;
  what: string;
  locale: Locale;
  small?: boolean;
}) {
  const r = getAdminDictionary(locale).reports;
  const label = r.excelAria(what);
  return (
    <a
      href={exportHref(kind, period)}
      aria-label={label}
      title={label}
      className={`adm-btn adm-btn-outline adm-no-print ${small ? "adm-btn-sm" : ""}`}
    >
      <FileSpreadsheet aria-hidden="true" />
      {r.excel}
    </a>
  );
}

/** A report that could not be read: what failed, a retry, and no figures. */
export function ReportFailed({ tab, period, locale }: { tab: ReportTab; period: ReportPeriod; locale: Locale }) {
  const t = getAdminDictionary(locale);
  return (
    <Notice tone="negative" retry={{ href: reportsHref({ tab, period }), label: t.common.retry }}>
      {t.reports.loadFailed}
    </Notice>
  );
}

/**
 * Nothing in the period: one line, and the next thing to try (the last 30 days, or this year when that is already
 * the period).
 */
export function ReportEmpty({
  tab,
  period,
  locale,
  children,
}: {
  tab: ReportTab;
  period: ReportPeriod;
  locale: Locale;
  children?: ReactNode;
}) {
  const r = getAdminDictionary(locale).reports;
  const wider =
    period.preset === "30d" || period.preset === "month" || period.preset === "last_month"
      ? { href: reportsHref({ tab, period: { from: "", to: "", preset: "year" } }), label: r.tryYear }
      : period.preset === "year"
        ? null
        : { href: reportsHref({ tab, period: { from: "", to: "", preset: "30d" } }), label: r.tryLonger };
  return (
    <Panel>
      <EmptyState
        icon={ChartColumn}
        action={
          wider ? (
            <Link href={wider.href} className="adm-btn adm-btn-outline">
              {wider.label}
            </Link>
          ) : undefined
        }
      >
        {children ?? r.emptyPeriod}
      </EmptyState>
    </Panel>
  );
}
