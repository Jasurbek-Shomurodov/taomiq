import { History, Lock, NotebookPen, SearchX, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { createElement, Suspense } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { categoryIcon, isExpenseCategory, isPaymentMethod } from "@/lib/admin/finance/categories";
import {
  HISTORY_KINDS,
  HISTORY_SEARCH_MAX,
  cleanHistorySearch,
  isHistoryKind,
  matchingCategories,
  parseHistoryCursor,
  type HistoryCursor,
  type HistoryDay,
  type HistoryKind,
  type HistoryRow,
} from "@/lib/admin/finance/history";
import { formatEntryDay } from "@/lib/admin/finance/month";
import { loadHistory, loadLockedThrough } from "@/lib/admin/finance/queries";
import { addDays, tashkentDay } from "@/lib/admin/stats";
import type { Tone } from "../../../../kit/Badge";
import { BeforeHydration } from "../../../../kit/BeforeHydration";
import { EmptyState } from "../../../../kit/EmptyState";
import { Notice } from "../../../../kit/Notice";
import { Panel } from "../../../../kit/Panel";
import { SearchField } from "../../../../kit/SearchField";
import { Segmented } from "../../../../kit/Segmented";
import { Skeleton } from "../../../../kit/Skeleton";
import { FinanceTabs } from "../../FinanceTabs";
import { DeleteEntry } from "../DeleteEntry";
import { RecordsViews } from "../RecordsViews";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale).finance;
  return { title: `${t.records.views.all} · ${t.title}` };
}

const BASE_PATH = "/finance/records/history";

/** The cursor's two parameters: a new search or kind drops them (the result set changed). */
const CURSOR_PARAMS = ["before", "bk"] as const;

/** Investor money in the info tone (it is not income), other income positive, spending plain. */
const KIND_TONES: Record<HistoryKind, Tone> = {
  expense: "neutral",
  salary: "neutral",
  investor: "info",
  other_income: "positive",
};
const AMOUNT_CLASS: Record<HistoryKind, string> = {
  expense: "text-adm-text",
  salary: "text-adm-text",
  investor: "text-adm-info",
  other_income: "text-adm-positive",
};

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The history's address: kind, search and the paging cursor together, so each keeps the others. */
function href({ kind, q, cursor }: { kind: HistoryKind | null; q: string; cursor?: HistoryCursor | null }): string {
  const params = new URLSearchParams();
  if (kind) params.set("type", kind);
  if (q) params.set("q", q);
  if (cursor) {
    params.set("before", cursor.day);
    params.set("bk", cursor.key);
  }
  const query = params.toString();
  return query ? `${BASE_PATH}?${query}` : BASE_PATH;
}

/** Rows grouped by their day, in the order they came (newest day first). */
function groupByDay(rows: readonly HistoryRow[]): { day: string; rows: HistoryRow[] }[] {
  const days: { day: string; rows: HistoryRow[] }[] = [];
  for (const row of rows) {
    let group = days.at(-1);
    if (!group || group.day !== row.day) {
      group = { day: row.day, rows: [] };
      days.push(group);
    }
    group.rows.push(row);
  }
  return days;
}

/**
 * Finance → Records → All history (docs/plans/zarkebab-feature-port.md, slice 8): every ledger record and salary
 * payment of all time from public.finance_history (migration 0024), newest first, 100 a page. `?q=` searches names,
 * comments, category names (in all three languages), amounts and days; `?type=` filters by kind; `?before=&bk=` is the
 * cursor of an older page. Each day's header totals every matching row of that day, also those on the next page.
 */
export default async function FinanceHistoryPage({ searchParams }: PageProps<"/admin/finance/records/history">) {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const r = t.finance.records;
  const h = r.history;
  const params = await searchParams;
  const typeParam = one(params.type);
  const kind = isHistoryKind(typeParam) ? typeParam : null;
  const q = cleanHistorySearch(one(params.q) ?? "");
  const cursor = parseHistoryCursor(one(params.before), one(params.bk));
  // Read the clock only after the session and the address (request-time reads).
  const today = tashkentDay(new Date())!;
  const categories = q
    ? matchingCategories(q, (["ru", "uz", "uzc"] as const).map((code) => getAdminDictionary(code).finance.categories))
    : [];

  const [history, locked] = await Promise.allSettled([
    loadHistory(supabase, { search: q, kind, categories, cursor }),
    loadLockedThrough(supabase),
  ]);
  const result = history.status === "fulfilled" ? history.value : null;
  if (history.status === "rejected") {
    console.error("finance history failed", history.reason instanceof Error ? history.reason.message : history.reason);
  }
  // Unknown (a failed read) keeps the delete buttons; the database refuses a closed month and the action says why.
  const lockedThrough = locked.status === "fulfilled" ? locked.value : null;
  if (locked.status === "rejected") {
    console.error("finance history: lock failed", locked.reason instanceof Error ? locked.reason.message : locked.reason);
  }

  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;
  const kindLabel = (value: HistoryKind) => (value === "salary" ? h.salaryKind : t.finance.kindsPlural[value]);
  const dayTitle = (day: string) => {
    const label = formatEntryDay(day, locale);
    if (day === today) return `${r.today}, ${label}`;
    if (day === addDays(today, -1)) return `${r.yesterday}, ${label}`;
    return label;
  };
  const totals = new Map<string, HistoryDay>((result?.days ?? []).map((day) => [day.day, day]));

  return (
    <div className="adm-page">
      <BeforeHydration>
        <FinanceTabs locale={locale} />
      </BeforeHydration>

      <RecordsViews current="all" locale={locale} />
      <p className="adm-caption">{h.lead}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Suspense fallback={<Skeleton className="h-11 w-full rounded-adm-control sm:max-w-sm" />}>
          <SearchField
            label={h.searchLabel}
            placeholder={h.searchPlaceholder}
            maxLength={HISTORY_SEARCH_MAX}
            reset={CURSOR_PARAMS}
            className="w-full sm:max-w-sm"
          />
        </Suspense>
        <Segmented
          label={h.kindsAria}
          value={kind ?? "all"}
          items={[
            { key: "all", label: r.all, href: href({ kind: null, q }) },
            ...HISTORY_KINDS.map((key) => ({ key, label: kindLabel(key), href: href({ kind: key, q }) })),
          ]}
          className="max-w-full"
        />
      </div>

      {!result ? (
        <Notice tone="negative" retry={{ href: href({ kind, q, cursor }), label: t.common.retry }}>
          {h.loadFailed}
        </Notice>
      ) : result.rows.length === 0 ? (
        <Panel>
          {q ? (
            <EmptyState
              icon={SearchX}
              action={
                <Link href={href({ kind, q: "" })} className="adm-btn adm-btn-outline">
                  {h.clearSearch}
                </Link>
              }
            >
              {h.emptySearch(q)}
            </EmptyState>
          ) : cursor ? (
            <EmptyState
              icon={History}
              action={
                <Link href={href({ kind, q })} className="adm-btn adm-btn-outline">
                  {h.newest}
                </Link>
              }
            >
              {h.emptyOlder}
            </EmptyState>
          ) : kind ? (
            <EmptyState
              icon={SearchX}
              action={
                <Link href={href({ kind: null, q })} className="adm-btn adm-btn-outline">
                  {r.showAll}
                </Link>
              }
            >
              {h.emptyKind(kindLabel(kind))}
            </EmptyState>
          ) : (
            <EmptyState
              icon={NotebookPen}
              action={
                <Link href="/finance/records" className="adm-btn adm-btn-primary">
                  {t.finance.toRecords}
                </Link>
              }
            >
              {h.empty}
            </EmptyState>
          )}
        </Panel>
      ) : (
        <>
          <p className="adm-caption tabular-nums" aria-live="polite">
            {h.shown(result.rows.length)}
          </p>
          {groupByDay(result.rows).map((group) => {
            const day = totals.get(group.day);
            return (
              <Panel
                key={group.day}
                flush
                title={dayTitle(group.day)}
                description={
                  day && (
                    <span className="tabular-nums">
                      {[
                        day.expenses > 0 && r.daySpent(sum(day.expenses)),
                        day.salaries > 0 && h.daySalaries(sum(day.salaries)),
                        day.other_income > 0 && r.dayIncome(sum(day.other_income)),
                        day.investor_support > 0 && r.dayInvestor(sum(day.investor_support)),
                        r.count(day.count),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )
                }
              >
                <ul>
                  {group.rows.map((row) => (
                    <HistoryRowItem
                      key={row.key}
                      row={row}
                      locked={lockedThrough !== null && row.day <= lockedThrough}
                      locale={locale}
                      t={t}
                      sum={sum}
                    />
                  ))}
                </ul>
              </Panel>
            );
          })}
        </>
      )}

      {result && (cursor || result.older) && (
        <nav aria-label={h.pagesAria} className="flex items-center justify-between gap-4 text-sm">
          {cursor ? (
            <Link href={href({ kind, q })} className="adm-btn adm-btn-outline">
              {h.newest}
            </Link>
          ) : (
            <span />
          )}
          {result.older ? (
            <Link href={href({ kind, q, cursor: result.older })} className="adm-btn adm-btn-outline">
              {h.older}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

function HistoryRowItem({
  row,
  locked,
  locale,
  t,
  sum,
}: {
  row: HistoryRow;
  /** Dated in a closed month: no delete. */
  locked: boolean;
  locale: Locale;
  t: AdminDictionary;
  sum: (value: number) => string;
}) {
  const r = t.finance.records;
  const h = r.history;
  const kind = row.kind;
  const isSalary = kind === "salary";
  const name =
    kind === "salary"
      ? h.salary
      : kind === "expense"
        ? isExpenseCategory(row.category)
          ? t.finance.categories[row.category]
          : row.category
        : t.finance.kinds[kind];
  const method = isPaymentMethod(row.method) ? t.finance.methods[row.method] : row.method;
  const counterparty = row.counterparty?.trim() || (row.kind === "investor" ? r.noName : "");
  const sign = row.kind === "expense" || isSalary ? "−" : "+";
  const summary = `${name} · ${sum(row.amount)} · ${formatEntryDay(row.day, locale)}`;
  const icon = isSalary ? UserRound : categoryIcon(row.category);

  return (
    <li className="adm-row flex items-start gap-3 px-4 py-3 sm:px-5">
      <span className={`adm-tone-${KIND_TONES[row.kind]} mt-0.5 grid size-9 shrink-0 place-items-center rounded-adm-control`}>
        {createElement(icon, { "aria-hidden": true, className: "size-4" })}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 font-semibold text-adm-text">
          {name}
          {row.purchase_id && (
            <span className="adm-badge adm-tone-neutral" title={r.purchaseLocked}>
              <Lock aria-hidden="true" />
              {r.fromPurchase}
            </span>
          )}
        </p>
        <p className="adm-caption" data-ph-mask>
          {[counterparty, method, row.added_by ? h.addedBy(row.added_by) : null].filter(Boolean).join(" · ")}
        </p>
        {row.note && (
          <p className="adm-caption mt-1 whitespace-pre-line break-words" data-ph-mask>
            {row.note}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-2">
        <span className={`whitespace-nowrap pt-1.5 font-semibold tabular-nums ${AMOUNT_CLASS[row.kind]}`}>
          {`${sign}${sum(row.amount)}`}
        </span>
        {row.purchase_id ? (
          <Link
            href={`/purchases/${row.purchase_id}`}
            aria-label={r.openPurchaseAria(summary)}
            className="adm-btn adm-btn-outline adm-btn-sm"
          >
            {r.openPurchase}
          </Link>
        ) : isSalary ? (
          row.employee_id && (
            <Link
              href={`/finance/payroll/${row.employee_id}`}
              aria-label={h.openEmployeeAria(`${row.counterparty ?? ""} · ${summary}`)}
              className="adm-btn adm-btn-outline adm-btn-sm"
            >
              {h.openEmployee}
            </Link>
          )
        ) : (
          !locked && <DeleteEntry id={row.id} summary={summary} locale={locale} />
        )}
      </div>
    </li>
  );
}
