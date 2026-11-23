import type { Metadata } from "next";
import Link from "next/link";
import { formatSum } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import {
  ORDER_STATUSES,
  STATUS_TABS,
  formatDateTime,
  formatDay,
  formatPhone,
  isOrderStatus,
  type OrderRow,
  type OrderStatus,
} from "@/lib/admin/orders";
import { ORDERS_PAGE_SIZE, listOrders, orderCounts } from "@/lib/admin/queries";
import { StatusBadge } from "./StatusBadge";

export const metadata: Metadata = { title: "Заказы" };

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
  const { supabase } = await requireOwner();
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
      <div>
        <h1 className="font-serif text-4xl text-forest">Заказы</h1>
        <p role="alert" className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-6 text-danger">
          Не удалось загрузить заказы. Обновите страницу через минуту.
        </p>
      </div>
    );
  }

  const { counts, orders, page, pages } = result;
  const all = ORDER_STATUSES.reduce((sum, s) => sum + counts[s], 0);

  return (
    <div>
      <h1 className="font-serif text-4xl text-forest">Заказы</h1>
      <p className="mt-1 text-sm text-muted">Новые сверху. Позвоните клиенту, подтвердите заказ и отметьте оплату.</p>

      <nav aria-label="Статусы заказов" className="mt-6 flex gap-2 overflow-x-auto pb-1">
        <Tab href={href(null)} active={!status} label="Все" count={all} />
        {ORDER_STATUSES.map((s) => (
          <Tab key={s} href={href(s)} active={status === s} label={STATUS_TABS[s]} count={counts[s]} />
        ))}
      </nav>

      {orders.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line bg-white/60 p-10 text-center text-muted">
          {page > 1
            ? "На этой странице заказов нет."
            : status
              ? `Нет заказов в разделе «${STATUS_TABS[status]}».`
              : "Заказов пока нет. Они появятся здесь, как только клиент оформит заказ на сайте."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="label p-3 text-muted">№</th>
                <th className="label p-3 text-muted">Создан</th>
                <th className="label p-3 text-muted">Клиент</th>
                <th className="label p-3 text-muted">Программа</th>
                <th className="label p-3 text-muted">Старт</th>
                <th className="label p-3 text-right text-muted">Сумма, сум</th>
                <th className="label p-3 text-muted">Статус</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-line last:border-0 hover:bg-ivory">
                  <td className="p-3">
                    <Link href={`/orders/${order.id}`} className="font-semibold tabular-nums text-forest underline-offset-4 hover:underline">
                      {order.number}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap p-3 tabular-nums text-muted">{formatDateTime(order.created_at)}</td>
                  <td className="p-3">
                    <Link href={`/orders/${order.id}`} className="block">
                      <span className="block font-semibold text-forest">{order.customer_name}</span>
                      <span className="block whitespace-nowrap text-xs tabular-nums text-muted">{formatPhone(order.phone)}</span>
                    </Link>
                  </td>
                  <td className="p-3">
                    {order.program_name} / <span className="tabular-nums">{order.kcal}</span>
                    <span className="block text-xs text-muted">
                      {order.days} дн.{order.weekdays_only ? ", без выходных" : ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap p-3 tabular-nums">{formatDay(order.start_date)}</td>
                  <td className="p-3 text-right tabular-nums">{formatSum(order.total)}</td>
                  <td className="p-3">
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Страницы" className="mt-4 flex items-center justify-between gap-4 text-sm">
          {page > 1 ? (
            <Link href={href(status, page - 1)} className="btn btn-outline !py-2">
              ← Новее
            </Link>
          ) : (
            <span />
          )}
          <span className="tabular-nums text-muted">
            Страница {page} из {pages}
          </span>
          {page < pages ? (
            <Link href={href(status, page + 1)} className="btn btn-outline !py-2">
              Старше →
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
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${
        active ? "border-forest bg-forest text-ivory" : "border-line bg-white text-forest hover:border-forest"
      }`}
    >
      {label}
      <span className={`tabular-nums ${active ? "text-ivory/70" : "text-muted"}`}>{count}</span>
    </Link>
  );
}
