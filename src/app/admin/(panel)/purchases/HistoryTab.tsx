import { Plus, ReceiptText, SearchX } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { requireStockAccess } from "@/lib/admin/auth";
import { formatEntryDay } from "@/lib/admin/finance/month";
import { purchasesHref, type PurchaseFilters } from "@/lib/admin/purchase-links";
import { PAYMENT_METHODS, PURCHASE_SEARCH_MAX, type PaymentMethod, type PurchasesPage } from "@/lib/admin/purchases";
import type { ReportPeriod } from "@/lib/admin/reports";
import { listCategories, loadPurchasesPage } from "@/lib/admin/stock-queries";
import { localized } from "@/lib/data/localized";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { SearchField } from "../../kit/SearchField";
import { Segmented } from "../../kit/Segmented";
import { Skeleton } from "../../kit/Skeleton";
import { CategoryFilter } from "./CategoryFilter";

/** Cut a search term the way the database does: at most PURCHASE_SEARCH_MAX characters, never splitting one. */
function cleanSearch(raw: string): string {
  return Array.from(raw).slice(0, PURCHASE_SEARCH_MAX).join("").trim();
}

/**
 * History: the receipts of the period, newest first, 50 a page, with a search (ingredient in any language, buyer,
 * note), a category and a payment method. Each row opens the receipt (edit and delete live there).
 */
export async function HistoryTab({
  period,
  filters,
  locale,
}: {
  period: ReportPeriod;
  filters: { q: string; category: string | null; method: PaymentMethod | null; page: number };
  locale: Locale;
}) {
  const { supabase } = await requireStockAccess();
  const t = getAdminDictionary(locale);
  const tp = t.purchases;
  const th = tp.history;
  const search = cleanSearch(filters.q);

  const [pageResult, categoriesResult] = await Promise.allSettled([
    loadPurchasesPage(supabase, { from: period.from, to: period.to, search, category: filters.category, method: filters.method, page: filters.page }),
    listCategories(supabase),
  ]);
  const result: PurchasesPage | null = pageResult.status === "fulfilled" ? pageResult.value : null;
  if (pageResult.status === "rejected") {
    console.error("purchases history failed", pageResult.reason instanceof Error ? pageResult.reason.message : pageResult.reason);
  }
  const categories =
    categoriesResult.status === "fulfilled"
      ? categoriesResult.value.map((c) => ({ id: c.id, name: localized(c, "name", locale) }))
      : [];

  const base: PurchaseFilters = { q: filters.q, category: filters.category, method: filters.method };
  const href = (next: PurchaseFilters) => purchasesHref({ tab: "history", period, filters: { ...base, ...next } });
  const filtering = search !== "" || filters.category !== null || filters.method !== null;
  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Suspense fallback={<Skeleton className="h-11 w-full rounded-adm-control sm:max-w-sm" />}>
          <SearchField
            label={th.searchLabel}
            placeholder={th.searchPlaceholder}
            maxLength={PURCHASE_SEARCH_MAX}
            className="w-full sm:max-w-sm"
          />
        </Suspense>
        {categories.length > 0 && (
          <CategoryFilter
            value={filters.category ?? ""}
            categories={categories}
            label={th.categoryLabel}
            allLabel={th.allCategories}
          />
        )}
        <Segmented
          label={th.methodAria}
          value={filters.method ?? "all"}
          items={[
            { key: "all", label: th.allMethods, href: href({ method: null, page: 1 }) },
            ...PAYMENT_METHODS.map((m) => ({ key: m, label: t.finance.methods[m], href: href({ method: m, page: 1 }) })),
          ]}
          className="max-w-full"
        />
      </div>

      {!result ? (
        <Notice tone="negative" retry={{ href: href({ page: filters.page }), label: t.common.retry }}>
          {th.loadFailed}
        </Notice>
      ) : result.rows.length === 0 ? (
        <Panel>
          {filtering ? (
            <EmptyState
              icon={SearchX}
              action={
                <Link href={purchasesHref({ tab: "history", period })} className="adm-btn adm-btn-outline">
                  {th.clear}
                </Link>
              }
            >
              {th.emptyFiltered}
            </EmptyState>
          ) : (
            <EmptyState
              icon={ReceiptText}
              action={
                <Link href="/purchases" className="adm-btn adm-btn-primary">
                  <Plus aria-hidden="true" />
                  {th.addFirst}
                </Link>
              }
            >
              {th.empty}
            </EmptyState>
          )}
        </Panel>
      ) : (
        <>
          <p className="adm-caption tabular-nums" aria-live="polite">
            {th.found(result.count, sum(result.amount))}
          </p>
          <Panel flush className="overflow-x-auto">
            <table className="w-full text-left text-sm sm:min-w-[44rem]">
              <thead className="adm-table-head max-sm:sr-only">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{th.columns.day}</th>
                  <th className="px-4 py-2.5 font-medium">{th.columns.items}</th>
                  <th className="px-4 py-2.5 font-medium">{th.columns.buyer}</th>
                  <th className="px-4 py-2.5 font-medium">{th.columns.method}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{th.columns.total}</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => {
                  const names = row.items.map((item) => localized(item, "name", locale));
                  const items =
                    names.join(", ") + (row.lines > names.length ? ` ${th.more(row.lines - names.length)}` : "");
                  const day = formatEntryDay(row.day, locale);
                  return (
                    <tr
                      key={row.id}
                      className="adm-row max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-3 max-sm:gap-y-0.5 max-sm:px-4 max-sm:py-3"
                    >
                      <td className="whitespace-nowrap font-medium text-adm-text sm:px-4 sm:py-3">
                        <Link href={`/purchases/${row.id}`} aria-label={th.openAria(`${day}, ${sum(row.total)}`)} className="hover:underline">
                          {day}
                        </Link>
                      </td>
                      <td className="text-adm-text max-sm:order-3 max-sm:col-span-2 sm:px-4 sm:py-3">
                        <span className="line-clamp-2">{items || "—"}</span>
                        {row.note && <span className="adm-caption block truncate sm:max-w-xs">{row.note}</span>}
                      </td>
                      <td className="text-adm-muted max-sm:order-4 max-sm:text-[13px] sm:px-4 sm:py-3">
                        {row.buyer_name || tp.noBuyer}
                      </td>
                      <td className="text-adm-muted max-sm:order-5 max-sm:text-right max-sm:text-[13px] sm:px-4 sm:py-3">
                        {row.payment_method ? t.finance.methods[row.payment_method] : "—"}
                      </td>
                      <td className="whitespace-nowrap text-right font-semibold tabular-nums text-adm-text max-sm:order-2 sm:px-4 sm:py-3">
                        {sum(row.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
          {result.pages > 1 && (
            <nav aria-label={th.pagesAria} className="flex items-center justify-between gap-4 text-sm">
              {result.page > 1 ? (
                <Link href={href({ page: result.page - 1 })} className="adm-btn adm-btn-outline">
                  {th.previous}
                </Link>
              ) : (
                <span />
              )}
              <span className="tabular-nums text-adm-muted">{th.pageOf(result.page, result.pages)}</span>
              {result.page < result.pages ? (
                <Link href={href({ page: result.page + 1 })} className="adm-btn adm-btn-outline">
                  {th.next}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
