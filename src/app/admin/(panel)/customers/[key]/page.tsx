import { CalendarClock, Phone, Plus, ShoppingBag, UserRoundX, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { requireOrdersAccess, requireStaff } from "@/lib/admin/auth";
import { getCustomer, listCustomerOrders } from "@/lib/admin/customer-queries";
import {
  CUSTOMER_ORDERS_LIMIT,
  customerHref,
  parseCustomerKey,
  type CustomerDetail,
  type CustomerOrder,
} from "@/lib/admin/customers";
import { telHref } from "@/lib/admin/deliveries";
import { formatDateTime, formatDay, formatPhone } from "@/lib/admin/orders";
import { tashkentDay } from "@/lib/admin/stats";
import { BeforeHydration } from "../../../kit/BeforeHydration";
import { EmptyState } from "../../../kit/EmptyState";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { StatTile } from "../../../kit/StatTile";
import { TopBarActions, TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";
import { StatusBadge } from "../../orders/StatusBadge";
import { CustomerStateBadge } from "../CustomerStateBadge";
import { CustomerNote } from "./CustomerNote";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).customers.heading };
}

/**
 * A customer (docs/plans/zarkebab-feature-port.md, slice 4): their figures, contacts, the staff note and every order.
 * The address holds the customer's key (an order id), resolved to the phone inside public.customer_detail and
 * public.customer_orders (migration 0020), which refuse anyone but owners and managers. "New order for this customer"
 * opens the new-order form with the same key, which fills in the name, phone, last address and window.
 */
export default async function CustomerPage({ params }: PageProps<"/admin/customers/[key]">) {
  const { key: rawKey } = await params;
  // Names, phones and addresses: owners and managers only (the functions refuse anyone else too).
  const { supabase, staff } = await requireOrdersAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const c = t.customers;
  const key = parseCustomerKey(rawKey);

  let customer: CustomerDetail | null = null;
  let failed = false;
  let orders: CustomerOrder[] | null = null;
  if (key) {
    // The history is read beside the customer; a failed history read leaves the page usable (its panel says so).
    const ordersRead = listCustomerOrders(supabase, key).catch((error: unknown) => {
      console.error("customer orders read failed", error instanceof Error ? error.message : error);
      return null;
    });
    try {
      customer = await getCustomer(supabase, key);
    } catch (error) {
      failed = true;
      console.error("customer read failed", error instanceof Error ? error.message : error);
    }
    orders = await ordersRead;
  }

  const back = <TopBarBack href="/customers" label={c.back} />;

  if (failed) {
    return (
      <div className="adm-page">
        {back}
        <Notice tone="negative" retry={{ href: customerHref(rawKey), label: t.common.retry }}>
          {c.detailFailed}
        </Notice>
      </div>
    );
  }

  // An unknown key: no order has this id (a mistyped or cut link; orders are never deleted). A key whose order's phone
  // was edited since does not land here: it opens the customer of that order's phone now, and a note opened before
  // the edit is refused on save (public.set_customer_note, customer_changed).
  if (!customer) {
    return (
      <div className="adm-page">
        {back}
        <Panel>
          <EmptyState
            icon={UserRoundX}
            title={c.notFound}
            action={
              <Link href="/customers" className="adm-btn adm-btn-outline">
                {c.back}
              </Link>
            }
          >
            {c.notFoundLead}
          </EmptyState>
        </Panel>
      </div>
    );
  }

  const isOwner = staff.role === "owner";
  const newOrder = (
    <Link href={`/orders/new?customer=${customer.customer_key}`} className="adm-btn adm-btn-primary">
      <Plus aria-hidden="true" />
      <span className="hidden sm:inline">{c.newOrder}</span>
      <span className="sm:hidden">{c.newOrderShort}</span>
    </Link>
  );
  const updatedLine = customer.note_updated_at
    ? c.noteUpdated(formatDateTime(customer.note_updated_at, locale), customer.note_updated_by)
    : null;

  return (
    <div className="adm-page">
      {back}
      <TopBarActions>{newOrder}</TopBarActions>
      {/* The top bar fills only once the scripts run; until then the button sits on the page. */}
      <BeforeHydration>
        <div className="flex justify-end">{newOrder}</div>
      </BeforeHydration>
      <TopBarTitle>
        <span className="adm-truncate" data-ph-mask>
          {customer.customer_name}
        </span>
        <CustomerStateBadge state={customer.state} locale={locale} />
      </TopBarTitle>
      <p className="adm-muted tabular-nums">
        {c.since(formatDay(tashkentDay(customer.first_order_at) ?? "", locale))} ·{" "}
        {c.lastOrderAt(formatDateTime(customer.last_order_at, locale))}
      </p>

      <Figures customer={customer} isOwner={isOwner} locale={locale} t={t} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="grid min-w-0 content-start gap-5">
          <Panel title={c.contact}>
            <p className="text-lg font-semibold text-adm-text" data-ph-mask>
              {customer.customer_name}
            </p>
            <p className="mt-1 tabular-nums" data-ph-mask>
              {formatPhone(customer.phone)}
            </p>
            <a href={telHref(customer.phone)} className="adm-btn adm-btn-outline mt-4">
              <Phone aria-hidden="true" />
              {c.call}
            </a>
            <dl className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-[11rem_1fr]">
              <dt className="text-sm text-adm-muted">{c.lastAddress}</dt>
              <dd className="whitespace-pre-line break-words text-adm-text" data-ph-mask>
                {customer.last_address || "—"}
              </dd>
              <dt className="text-sm text-adm-muted">{c.lastWindow}</dt>
              <dd className="tabular-nums text-adm-text">{customer.last_window || "—"}</dd>
              <dt className="text-sm text-adm-muted">{c.account}</dt>
              <dd className="text-adm-text">{customer.has_account ? c.accountYes : c.accountNo}</dd>
              <dt className="text-sm text-adm-muted">{c.source}</dt>
              <dd className="break-words text-adm-text">{customer.source ?? c.direct}</dd>
            </dl>
          </Panel>

          <History orders={orders} customerKey={customer.customer_key} locale={locale} t={t} />
        </div>

        <aside className="grid min-w-0 content-start gap-5 xl:sticky xl:top-6">
          <CustomerNote
            customerKey={customer.customer_key}
            phone={customer.phone}
            note={customer.note}
            updatedLine={updatedLine}
            locale={locale}
          />
        </aside>
      </div>
    </div>
  );
}

function Figures({
  customer,
  isOwner,
  locale,
  t,
}: {
  customer: CustomerDetail;
  isOwner: boolean;
  locale: Locale;
  t: AdminDictionary;
}) {
  const c = t.customers;
  const f = c.figures;
  const plan = customer.plan_ends
    ? { label: f.planEnds, value: formatDay(customer.plan_ends, locale) }
    : customer.last_plan_end
      ? { label: f.lastPlanEnd, value: formatDay(customer.last_plan_end, locale) }
      : { label: f.planEnds, value: f.noPlan };

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
      <StatTile
        label={f.orders}
        value={customer.orders_count}
        icon={ShoppingBag}
        footer={<span>{f.paid(customer.paid_count)}</span>}
      />
      {/* Owner only: the database returns no money totals to a manager. */}
      {isOwner && (
        <StatTile
          label={f.totalPaid}
          value={customer.total_paid === null ? "—" : `${formatSum(customer.total_paid)} ${t.common.currency}`}
          icon={Wallet}
          footer={<span>{f.totalNote}</span>}
        />
      )}
      <StatTile
        label={plan.label}
        value={<span className="text-xl">{plan.value}</span>}
        icon={CalendarClock}
        tone={customer.state === "ending" ? "caution" : customer.state === "lapsed" ? "negative" : "accent"}
        footer={<CustomerStateBadge state={customer.state} locale={locale} />}
      />
    </div>
  );
}

function History({
  orders,
  customerKey,
  locale,
  t,
}: {
  orders: CustomerOrder[] | null;
  customerKey: string;
  locale: Locale;
  t: AdminDictionary;
}) {
  const c = t.customers;
  if (!orders) {
    return (
      <Notice tone="negative" retry={{ href: customerHref(customerKey), label: t.common.retry }}>
        {c.historyFailed}
      </Notice>
    );
  }

  return (
    <Panel flush title={c.history} description={orders.length >= CUSTOMER_ORDERS_LIMIT ? c.historyLimit(orders.length) : undefined}>
      {orders.length === 0 ? (
        <EmptyState icon={ShoppingBag}>{c.historyEmpty}</EmptyState>
      ) : (
        <ul>
          {orders.map((order) => (
            <li key={order.id} className="adm-row">
              <Link href={`/orders/${order.id}`} className="grid gap-1 px-4 py-3 sm:px-5">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold tabular-nums text-adm-accent-ink">
                    {t.orders.number} {order.number}
                    <span className="ml-2 text-[13px] font-normal text-adm-muted">
                      {formatDateTime(order.created_at, locale)}
                    </span>
                  </span>
                  <StatusBadge status={order.status} locale={locale} />
                </span>
                <span className="text-sm text-adm-text">
                  {order.program_name} / <span className="tabular-nums">{order.kcal}</span> ·{" "}
                  {t.orders.daysShort(order.days)}
                  {order.weekdays_only ? t.orders.noWeekends : ""}
                </span>
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-adm-muted">
                  <span className="tabular-nums">
                    {formatDay(order.start_date, locale)}
                    {order.end_date && <> · {c.until(formatDay(order.end_date, locale))}</>}
                  </span>
                  <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-adm-text">
                    {formatSum(order.total)} {t.common.currency}
                    {order.payment_method && (
                      <span className="ml-2 text-[13px] font-normal text-adm-muted">
                        {t.finance.methods[order.payment_method]}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
