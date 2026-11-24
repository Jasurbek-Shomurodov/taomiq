import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum } from "@/i18n/config";
import { requireOwner, requireStaff } from "@/lib/admin/auth";
import {
  ORDER_STATUSES,
  formatDateTime,
  formatDay,
  formatPhone,
  isOrderStatus,
  type OrderRow,
  type OrderStatus,
} from "@/lib/admin/orders";
import { ORDERS_PAGE_SIZE, listOrders, orderCounts } from "@/lib/admin/queries";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { StatusBadge } from "./StatusBadge";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).orders.title };
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function href(status: OrderStatus | null, page = 1): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/orders?${query}` : "/orders";
}

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const params = await searchParams;
  const statusParam = one(params.status);
  const status = isOrderStatus(statusParam) ? statusParam : null;
  const pageParam = Number(one(params.page));
  const requestedPage = Number.isSafeInteger(pageParam) && pageParam > 1 ? pageParam : 1;

  // Counts first: they give the number of pages, so a page past the end shows the last one.
  let result: { counts: Record<OrderStatus, number>; orders: OrderRow[]; page: number; pages: number } | null = null;
  try {
    const counts = await orderCounts(supabase);
    const total = status ? counts[status] : ORDER_STATUSES.reduce((sum, s) => sum + counts[s], 0);
    const pages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
    const page = Math.min(requestedPage, pages);
    result = { counts, orders: await listOrders(supabase, status, page), page, pages };
  } catch (error) {
    console.error("orders list failed", error instanceof Error ? error.message : error);
  }

  if (!result) {
    return (
      <div className="adm-page">
        <Notice tone="negative" retry={{ href: href(status, requestedPage), label: t.common.retry }}>
          {t.orders.loadFailed}
        </Notice>
      </div>
    );
  }

  const { counts, orders, page, pages } = result;
  const all = ORDER_STATUSES.reduce((sum, s) => sum + counts[s], 0);

  return (
    <div className="adm-page">
      <p className="adm-muted">{t.orders.lead}</p>

      <nav aria-label={t.orders.statusesAria} className="adm-segmented self-start">
        <Tab href={href(null)} active={!status} label={t.orders.all} count={all} />
        {ORDER_STATUSES.map((s) => (
          <Tab key={s} href={href(s)} active={status === s} label={t.orders.tabs[s]} count={counts[s]} />
        ))}
      </nav>

      {orders.length === 0 ? (
        <Panel>
          <EmptyState icon={Inbox}>
            {page > 1 ? t.orders.pageEmpty : status ? t.orders.statusEmpty(t.orders.tabs[status]) : t.orders.none}
          </EmptyState>
        </Panel>
      ) : (
        <Panel flush className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="adm-table-head">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t.orders.number}</th>
                <th className="px-4 py-2.5 font-medium">{t.orders.created}</th>
                <th className="px-4 py-2.5 font-medium">{t.orders.customer}</th>
                <th className="px-4 py-2.5 font-medium">{t.orders.program}</th>
                <th className="px-4 py-2.5 font-medium">{t.orders.start}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t.orders.sum}</th>
                <th className="px-4 py-2.5 font-medium">{t.orders.status}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="adm-row">
                  <td className="px-4 py-3">
                    <Link
                      href={`/orders/${order.id}`}
                      className="font-semibold tabular-nums text-adm-accent-ink underline-offset-4 hover:underline"
                    >
                      {order.number}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-adm-muted">
                    {formatDateTime(order.created_at, locale)}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/orders/${order.id}`} className="block">
                      <span className="block font-semibold text-adm-text">{order.customer_name}</span>
                      <span className="block whitespace-nowrap text-[13px] tabular-nums text-adm-muted">
                        {formatPhone(order.phone)}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {order.program_name} / <span className="tabular-nums">{order.kcal}</span>
                    <span className="block text-[13px] text-adm-muted">
                      {t.orders.daysShort(order.days)}
                      {order.weekdays_only ? t.orders.noWeekends : ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDay(order.start_date, locale)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatSum(order.total)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} locale={locale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {pages > 1 && (
        <nav aria-label={t.orders.pagesAria} className="flex items-center justify-between gap-4 text-sm">
          {page > 1 ? (
            <Link href={href(status, page - 1)} className="adm-btn adm-btn-outline">
              {t.orders.newer}
            </Link>
          ) : (
            <span />
          )}
          <span className="tabular-nums text-adm-muted">{t.orders.pageOf(page, pages)}</span>
          {page < pages ? (
            <Link href={href(status, page + 1)} className="adm-btn adm-btn-outline">
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

function Tab({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}>
      {label}
      <span className="adm-count">{count}</span>
    </Link>
  );
}
