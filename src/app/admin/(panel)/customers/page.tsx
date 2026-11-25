import { Contact, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { requireOrdersAccess, requireStaff } from "@/lib/admin/auth";
import { loadCustomersPage, type CustomersPage as PageData } from "@/lib/admin/customer-queries";
import {
  CUSTOMER_FILTERS,
  ENDING_SOON_DAYS,
  LAPSED_AFTER_DAYS,
  NEW_WITHIN_DAYS,
  customerSearchTerm,
  isCustomerFilter,
  type CustomerFilter,
} from "@/lib/admin/customers";
import { ORDER_SEARCH_MAX, cutCodePoints } from "@/lib/admin/order-search";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { SearchField } from "../../kit/SearchField";
import { Skeleton } from "../../kit/Skeleton";
import { TopBarTabs } from "../../shell/TopBarSlot";
import { CustomersTable } from "./CustomersTable";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).nav.customers };
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The list's address: filter, page and search together, so chips and pages keep each other. */
function href({ filter, page = 1, q = "" }: { filter: CustomerFilter; page?: number; q?: string }): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/customers?${query}` : "/customers";
}

function filterLead(filter: CustomerFilter, t: AdminDictionary): string {
  const lead = t.customers.filterLead;
  switch (filter) {
    case "ending":
      return lead.ending(ENDING_SOON_DAYS);
    case "lapsed":
      return lead.lapsed(LAPSED_AFTER_DAYS);
    case "new":
      return lead.new(NEW_WITHIN_DAYS);
    default:
      return lead[filter];
  }
}

/**
 * Customers (docs/plans/zarkebab-feature-port.md, slice 4): one row per phone number across every order, read from
 * public.customers_page (migration 0020) in one call (the chip counts and the page), which refuses anyone but owners
 * and managers and returns money totals to the owner only. `?filter=` picks a chip, `?q=` searches (the orders list's convention: the
 * term in the address, cleaned before it reaches the database), `?page=` pages by 50.
 */
export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  // Customers' names and phones: owners and managers only (the functions refuse anyone else too).
  const { supabase, staff } = await requireOrdersAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const c = t.customers;
  const isOwner = staff.role === "owner";
  const params = await searchParams;
  const filterParam = one(params.filter);
  const filter: CustomerFilter = isCustomerFilter(filterParam) ? filterParam : "all";
  const pageParam = Number(one(params.page));
  const requestedPage = Number.isSafeInteger(pageParam) && pageParam > 1 ? pageParam : 1;
  // Links carry the term as typed (URLSearchParams encodes it), so the box keeps showing it; the database only ever
  // sees customerSearchTerm() output: letters, digits, spaces and "+".
  const typed = cutCodePoints(one(params.q), 100).trim();
  const search = customerSearchTerm(typed);
  const searching = search !== null;

  // One call: the chip counts (with a search on, of the matching customers, so the chips agree with the list) and the
  // page, which the database clamps to the last one when the requested page is past the end.
  let result: PageData | null = null;
  try {
    result = await loadCustomersPage(supabase, filter, requestedPage, search);
  } catch (error) {
    console.error("customers list failed", error instanceof Error ? error.message : error);
  }

  const found = result ? result.counts[filter] : null;

  // The filter chips: counts when they loaded (with a search on, of the matching customers), none when they did not,
  // so the chips still work after a failed load.
  const tabs = (
    <nav aria-label={c.filtersAria} className="adm-tabs">
      {CUSTOMER_FILTERS.map((key) => (
        <Link
          key={key}
          href={href({ filter: key, q: typed })}
          aria-current={filter === key ? "page" : undefined}
          scroll={false}
        >
          {c.filters[key]}
          {result && <span className="adm-count">{result.counts[key]}</span>}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="adm-page">
      <TopBarTabs>{tabs}</TopBarTabs>
      {/* The top bar fills only once the scripts run; until then the same chips sit on the page. */}
      <BeforeHydration>{tabs}</BeforeHydration>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Suspense fallback={<Skeleton className="h-11 w-full rounded-adm-control sm:max-w-sm" />}>
          <SearchField
            label={c.searchLabel}
            placeholder={c.searchPlaceholder}
            maxLength={ORDER_SEARCH_MAX}
            className="w-full sm:max-w-sm"
          />
        </Suspense>
        <p className="adm-caption tabular-nums" aria-live="polite">
          {found !== null && searching ? c.found(found) : c.lead}
        </p>
      </div>
      <p className="adm-caption -mt-2">{filterLead(filter, t)}</p>

      {!result ? (
        <Notice tone="negative" retry={{ href: href({ filter, page: requestedPage, q: typed }), label: t.common.retry }}>
          {c.loadFailed}
        </Notice>
      ) : result.rows.length === 0 ? (
        <Panel>
          {searching ? (
            <EmptyState
              icon={SearchX}
              action={
                <Link href={href({ filter })} className="adm-btn adm-btn-outline">
                  {c.clearSearch}
                </Link>
              }
            >
              {filter === "all" ? c.searchEmpty(typed) : c.searchFilterEmpty(typed, c.filters[filter])}
            </EmptyState>
          ) : result.page > 1 ? (
            <EmptyState icon={Contact}>{c.pageEmpty}</EmptyState>
          ) : filter !== "all" ? (
            <EmptyState
              icon={Contact}
              action={
                <Link href={href({ filter: "all" })} className="adm-btn adm-btn-outline">
                  {c.showAll}
                </Link>
              }
            >
              {c.filterEmpty(c.filters[filter])}
            </EmptyState>
          ) : (
            <EmptyState
              icon={Contact}
              action={
                <Link href="/orders/new" className="adm-btn adm-btn-outline">
                  {t.orders.add}
                </Link>
              }
            >
              {c.none}
            </EmptyState>
          )}
        </Panel>
      ) : (
        <CustomersTable rows={result.rows} showTotal={isOwner} locale={locale} />
      )}

      {result && result.pages > 1 && (
        <nav aria-label={t.orders.pagesAria} className="flex items-center justify-between gap-4 text-sm">
          {result.page > 1 ? (
            <Link href={href({ filter, page: result.page - 1, q: typed })} className="adm-btn adm-btn-outline">
              {c.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="tabular-nums text-adm-muted">{t.orders.pageOf(result.page, result.pages)}</span>
          {result.page < result.pages ? (
            <Link href={href({ filter, page: result.page + 1, q: typed })} className="adm-btn adm-btn-outline">
              {c.next}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
