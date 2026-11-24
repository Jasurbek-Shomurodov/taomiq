import { ChevronLeft, ChevronRight, NotebookPen, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { createElement } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { categoryIcon, isEntryKind, isPaymentMethod, type EntryKind } from "@/lib/admin/finance/categories";
import { financeMonth, formatEntryDay, formatMonth, type FinanceMonth } from "@/lib/admin/finance/month";
import { ENTRIES_CAP, listMonthEntries, type FinanceEntry } from "@/lib/admin/finance/queries";
import { addDays, tashkentDay } from "@/lib/admin/stats";
import { BeforeHydration } from "../../../kit/BeforeHydration";
import type { Tone } from "../../../kit/Badge";
import { EmptyState } from "../../../kit/EmptyState";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { Segmented } from "../../../kit/Segmented";
import { FinanceTabs } from "../FinanceTabs";
import { DeleteEntry } from "./DeleteEntry";
import { EntryForm } from "./EntryForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale).finance;
  return { title: `${t.tabs.records} · ${t.title}` };
}

const BASE_PATH = "/finance/records";

/** Investor money always in the info tone (it is not income); other income positive; expenses plain. */
const KIND_TONES: Record<EntryKind, Tone> = { expense: "neutral", investor: "info", other_income: "positive" };
const AMOUNT_CLASS: Record<EntryKind, string> = {
  expense: "text-adm-text",
  investor: "text-adm-info",
  other_income: "text-adm-positive",
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The history's address: the month (left out for the current one) and the kind filter. */
function href(month: string | null, kind: EntryKind | null): string {
  const params = new URLSearchParams();
  if (month) params.set("m", month);
  if (kind) params.set("type", kind);
  const query = params.toString();
  return query ? `${BASE_PATH}?${query}` : BASE_PATH;
}

type Day = { day: string; entries: FinanceEntry[]; spent: number; income: number; investor: number };

/** Records grouped by their date, in the order they came (newest day first). */
function groupByDay(entries: readonly FinanceEntry[]): Day[] {
  const days: Day[] = [];
  for (const entry of entries) {
    let day = days.at(-1);
    if (!day || day.day !== entry.entry_date) {
      day = { day: entry.entry_date, entries: [], spent: 0, income: 0, investor: 0 };
      days.push(day);
    }
    day.entries.push(entry);
    if (entry.kind === "expense") day.spent += entry.amount;
    else if (entry.kind === "investor") day.investor += entry.amount;
    else if (entry.kind === "other_income") day.income += entry.amount;
  }
  return days;
}

/**
 * Finance → Records (docs/plans/finance-investor-payroll.md, slice 1): the form for a new record, then a month of the
 * ledger grouped by day. `?m=YYYY-MM` picks the month (the current one by default, never a future one) and
 * `?type=expense|investor|other_income` filters it. A record cannot be edited: a wrong one is deleted (asked first)
 * and entered again.
 */
export default async function FinanceRecordsPage({ searchParams }: PageProps<"/admin/finance/records">) {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const r = t.finance.records;
  const params = await searchParams;
  // Read the clock only after the session and the address (request-time reads), so it is the request's time.
  const today = tashkentDay(new Date())!;
  const month = financeMonth(one(params.m), today);
  const kindParam = one(params.type);
  const kind = isEntryKind(kindParam) ? kindParam : null;
  const monthParam = month.isCurrent ? null : month.key;
  const monthName = formatMonth(month.key, locale);

  let data: { entries: FinanceEntry[]; partial: boolean } | null = null;
  try {
    data = await listMonthEntries(supabase, month, kind);
  } catch (error) {
    console.error("finance records failed", error instanceof Error ? error.message : error);
  }

  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;
  const dayTitle = (day: string) => {
    const label = formatEntryDay(day, locale);
    if (day === today) return `${r.today}, ${label}`;
    if (day === addDays(today, -1)) return `${r.yesterday}, ${label}`;
    return label;
  };

  return (
    <div className="adm-page">
      <BeforeHydration>
        <FinanceTabs locale={locale} />
      </BeforeHydration>

      <Panel title={r.formTitle} description={r.formLead}>
        <EntryForm locale={locale} today={today} />
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} current={today.slice(0, 7)} kind={kind} label={monthName} t={t} />
        <Segmented
          label={r.filter}
          value={kind ?? "all"}
          items={[
            { key: "all", label: r.all, href: href(monthParam, null) },
            { key: "expense", label: t.finance.kindsPlural.expense, href: href(monthParam, "expense") },
            { key: "investor", label: t.finance.kindsPlural.investor, href: href(monthParam, "investor") },
            { key: "other_income", label: t.finance.kindsPlural.other_income, href: href(monthParam, "other_income") },
          ]}
          className="max-w-full"
        />
      </div>

      {!data ? (
        <Notice tone="negative" retry={{ href: href(monthParam, kind), label: t.common.retry }}>
          {r.loadFailed}
        </Notice>
      ) : data.entries.length === 0 ? (
        <Panel>
          {kind ? (
            <EmptyState
              icon={SearchX}
              action={
                <Link href={href(monthParam, null)} className="adm-btn adm-btn-outline">
                  {r.showAll}
                </Link>
              }
            >
              {r.emptyFiltered(t.finance.kindsPlural[kind], monthName)}
            </EmptyState>
          ) : (
            <EmptyState icon={NotebookPen}>{r.empty(monthName)}</EmptyState>
          )}
        </Panel>
      ) : (
        <>
          <p className="adm-caption tabular-nums">{r.count(data.entries.length)}</p>
          {data.partial && <Notice tone="caution">{r.partial(formatSum(ENTRIES_CAP))}</Notice>}
          {groupByDay(data.entries).map((day) => (
            <Panel
              key={day.day}
              flush
              title={dayTitle(day.day)}
              description={
                <span className="tabular-nums">
                  {[
                    day.spent > 0 && r.daySpent(sum(day.spent)),
                    day.income > 0 && r.dayIncome(sum(day.income)),
                    day.investor > 0 && r.dayInvestor(sum(day.investor)),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              }
            >
              <ul>
                {day.entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} locale={locale} t={t} sum={sum} />
                ))}
              </ul>
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}

function MonthNav({
  month,
  current,
  kind,
  label,
  t,
}: {
  month: FinanceMonth;
  /** The current month's key, "YYYY-MM". */
  current: string;
  kind: EntryKind | null;
  label: string;
  t: AdminDictionary;
}) {
  const r = t.finance.records;
  // The current month is the address without ?m.
  const target = (key: string | null) => (key ? href(key === current ? null : key, kind) : null);
  return (
    <nav aria-label={r.monthNav} className="flex items-center gap-1.5">
      <Arrow href={target(month.prev)} label={r.prevMonth}>
        <ChevronLeft aria-hidden="true" />
      </Arrow>
      <h2 className="adm-heading min-w-40 text-center tabular-nums">{label}</h2>
      <Arrow href={target(month.next)} label={r.nextMonth}>
        <ChevronRight aria-hidden="true" />
      </Arrow>
    </nav>
  );
}

function Arrow({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const className = "adm-btn adm-btn-outline adm-btn-sm adm-btn-icon";
  return href ? (
    <Link href={href} aria-label={label} title={label} className={className} scroll={false}>
      {children}
    </Link>
  ) : (
    <span role="link" aria-disabled="true" aria-label={label} title={label} className={className}>
      {children}
    </span>
  );
}

function EntryRow({
  entry,
  locale,
  t,
  sum,
}: {
  entry: FinanceEntry;
  locale: Locale;
  t: AdminDictionary;
  sum: (value: number) => string;
}) {
  const r = t.finance.records;
  const kind = entry.kind;
  const name =
    kind === "expense"
      ? t.finance.categories[entry.category as keyof typeof t.finance.categories]
      : kind
        ? t.finance.kinds[kind]
        : entry.category;
  const method = isPaymentMethod(entry.payment_method) ? t.finance.methods[entry.payment_method] : entry.payment_method;
  // Investor money without a name cannot happen through the form; older or hand-made rows say so.
  const counterparty = entry.counterparty?.trim() || (kind === "investor" ? r.noName : "");
  const sign = kind === "expense" ? "−" : kind ? "+" : "";
  const amountText = `${sign}${sum(entry.amount)}`;
  const summary = `${name} · ${sum(entry.amount)} · ${formatEntryDay(entry.entry_date, locale)}`;

  return (
    <li className="adm-row flex items-start gap-3 px-4 py-3 sm:px-5">
      <span
        className={`adm-tone-${kind ? KIND_TONES[kind] : "neutral"} mt-0.5 grid size-9 shrink-0 place-items-center rounded-adm-control`}
      >
        {createElement(categoryIcon(entry.category), { "aria-hidden": true, className: "size-4" })}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-adm-text">{name}</p>
        <p className="adm-caption" data-ph-mask>
          {[counterparty, method].filter(Boolean).join(" · ")}
        </p>
        {entry.note && (
          <p className="adm-caption mt-1 whitespace-pre-line break-words" data-ph-mask>
            {entry.note}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-2">
        <span
          className={`whitespace-nowrap pt-1.5 font-semibold tabular-nums ${kind ? AMOUNT_CLASS[kind] : "text-adm-text"}`}
        >
          {amountText}
        </span>
        <DeleteEntry id={entry.id} summary={summary} locale={locale} />
      </div>
    </li>
  );
}
