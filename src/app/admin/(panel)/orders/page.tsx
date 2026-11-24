import { Inbox, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { requireOrdersAccess, requireStaff } from "@/lib/admin/auth";
import { ORDER_SEARCH_MAX, cutCodePoints, orderSearchFilter } from "@/lib/admin/order-search";
import { ORDER_STATUSES, isOrderStatus, type OrderRow, type OrderStatus } from "@/lib/admin/orders";
import { ORDERS_PAGE_SIZE, listOrders, orderCounts } from "@/lib/admin/queries";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { SearchField } from "../../kit/SearchField";
import { Skeleton } from "../../kit/Skeleton";
import { TopBarTabs } from "../../shell/TopBarSlot";
import { OrdersTable } from "./OrdersTable";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).orders.title };
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** The list's address: status, page and search together, so tabs and pages keep each other. */
function href({ status, page = 1, q = "" }: { status: OrderStatus | null; page?: number; q?: string }): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/orders?${query}` : "/orders";
}

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  // Orders hold personal data: owners and managers only (RLS returns nothing to anyone else either).
  const { supabase, staff } = await requireOrdersAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const params = await searchParams;
  const statusParam = one(params.status);
  const status = isOrderStatus(statusParam) ? statusParam : null;
  const pageParam = Number(one(params.page));
  const requestedPage = Number.isSafeInteger(pageParam) && pageParam > 1 ? pageParam : 1;
  // Links carry the term as typed (URLSearchParams encodes it), so the box keeps showing it; the query only ever
  // sees orderSearchFilter() output: letters, digits, spaces and "+" (lib/admin/order-search.ts).
  const typed = cutCodePoints(one(params.q), 100).trim();
  const search = orderSearchFilter(typed);
  const searching = search !== null;

  // Counts first: they give the number of pages, so a page past the end shows the last one. With a search on,
  // they count the matching orders, so the tabs agree with the list.
  let result: { counts: Record<OrderStatus, number>; orders: OrderRow[]; page: number; pages: number } | null = null;
  try {
    const counts = await orderCounts(supabase, search);
    const total = status ? counts[status] : ORDER_STATUSES.reduce((sum, s) => sum + counts[s], 0);
    const pages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
    const page = Math.min(requestedPage, pages);
    result = { counts, orders: await listOrders(supabase, status, page, search), page, pages };
  } catch (error) {
    console.error("orders list failed", error instanceof Error ? error.message : error);
  }

  const all = result ? ORDER_STATUSES.reduce((sum, s) => sum + result.counts[s], 0) : 0;
  const found = result ? (status ? result.counts[status] : all) : null;

  // The status tabs: counts when they loaded (with a search on, of the matching orders), none when they did not,
  // so the tabs still work after a failed load.
  const tabs = (
    <nav aria-label={t.orders.statusesAria} className="adm-tabs">
      <Tab href={href({ status: null, q: typed })} active={!status} label={t.orders.all} count={result ? all : null} />
      {ORDER_STATUSES.map((s) => (
        <Tab
          key={s}
          href={href({ status: s, q: typed })}
          active={status === s}
          label={t.orders.tabs[s]}
          count={result ? result.counts[s] : null}
        />
      ))}
    </nav>
  );

  // One tree for every state, so the search box keeps its place (and focus) whatever the search returns.
  return (
    <div className="adm-page">
      <TopBarTabs>{tabs}</TopBarTabs>
      {/* The top bar fills only once the scripts run; until then the same tabs sit on the page. */}
      <BeforeHydration>{tabs}</BeforeHydration>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Suspense fallback={<Skeleton className="h-11 w-full rounded-adm-control sm:max-w-sm" />}>
          <SearchField
            label={t.orders.searchLabel}
            placeholder={t.orders.searchPlaceholder}
            maxLength={ORDER_SEARCH_MAX}
            className="w-full sm:max-w-sm"
          />
        </Suspense>
        <p className="adm-caption tabular-nums" aria-live="polite">
          {found !== null && searching ? t.orders.found(found) : t.orders.lead}
        </p>
      </div>

      {!result ? (
        <Notice tone="negative" retry={{ href: href({ status, page: requestedPage, q: typed }), label: t.common.retry }}>
          {t.orders.loadFailed}
        </Notice>
      ) : result.orders.length === 0 ? (
        <Panel>
          {searching ? (
            <EmptyState
              icon={SearchX}
              action={
                <Link href={href({ status })} className="adm-btn adm-btn-outline">
                  {t.orders.clearSearch}
                </Link>
              }
            >
              {status ? t.orders.searchStatusEmpty(typed, t.orders.tabs[status]) : t.orders.searchEmpty(typed)}
            </EmptyState>
          ) : (
            <EmptyState icon={Inbox}>
              {result.page > 1
                ? t.orders.pageEmpty
                : status
                  ? t.orders.statusEmpty(t.orders.tabs[status])
                  : t.orders.none}
            </EmptyState>
          )}
        </Panel>
      ) : (
        <OrdersTable orders={result.orders} locale={locale} />
      )}

      {result && result.pages > 1 && (
        <nav aria-label={t.orders.pagesAria} className="flex items-center justify-between gap-4 text-sm">
          {result.page > 1 ? (
            <Link href={href({ status, page: result.page - 1, q: typed })} className="adm-btn adm-btn-outline">
              {t.orders.newer}
            </Link>
          ) : (
            <span />
          )}
          <span className="tabular-nums text-adm-muted">{t.orders.pageOf(result.page, result.pages)}</span>
          {result.page < result.pages ? (
            <Link href={href({ status, page: result.page + 1, q: typed })} className="adm-btn adm-btn-outline">
              {t.orders.older}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

function Tab({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  /** null when the counts could not be read: no pill rather than a made-up 0. */
  count: number | null;
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} scroll={false}>
      {label}
      {count !== null && <span className="adm-count">{count}</span>}
    </Link>
  );
}
