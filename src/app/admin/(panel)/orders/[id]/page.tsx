import { Pencil, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, isLocale } from "@/i18n/config";
import { requireOrdersAccess, requireStaff } from "@/lib/admin/auth";
import {
  canChangePaymentMethod,
  canEdit,
  formatDateTime,
  formatDay,
  formatPhone,
  type Order,
  type OrderEvent,
} from "@/lib/admin/orders";
import { canPause, PAUSE_MAX_DAYS_DEFAULT, type OrderPause } from "@/lib/admin/pauses";
import { getOrder, getPauseMaxDays, listOrderEvents, listOrderPauses } from "@/lib/admin/queries";
import { tashkentDay } from "@/lib/admin/stats";
import { formatLocation } from "@/lib/order/location";
import { BeforeHydration } from "../../../kit/BeforeHydration";
import { MapLinks } from "../../../kit/MapLinks";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { TopBarActions, TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";
import { NoteForm, PaymentMethodControl, StatusControls } from "../OrderControls";
import { OrderHistory } from "../OrderHistory";
import { OrderPauses } from "../OrderPauses";
import { StatusBadge } from "../StatusBadge";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).order.title };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  // Personal data: owners and managers only (RLS returns nothing to anyone else either).
  const { supabase, staff } = await requireOrdersAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  if (!UUID_RE.test(id)) notFound();

  let order: Order | null = null;
  let failed = false;
  // The history is read beside the order; a failed history read leaves the order usable (its panel says so).
  const eventsRead = listOrderEvents(supabase, id).catch((error: unknown) => {
    console.error("order history read failed", error instanceof Error ? error.message : error);
    return null;
  });
  // Pauses (migration 0028) the same way: a failed read leaves the order usable, and their panel says so.
  const pausesRead = listOrderPauses(supabase, id).catch((error: unknown) => {
    console.error("order pauses read failed", error instanceof Error ? error.message : error);
    return null;
  });
  const pauseMaxRead = getPauseMaxDays(supabase).catch(() => PAUSE_MAX_DAYS_DEFAULT);
  try {
    order = await getOrder(supabase, id);
  } catch (error) {
    failed = true;
    console.error("order read failed", error instanceof Error ? error.message : error);
  }
  const events: OrderEvent[] | null = await eventsRead;
  const pauses: OrderPause[] | null = await pausesRead;
  const pauseMax = await pauseMaxRead;

  if (failed) {
    return (
      <div className="adm-page">
        <TopBarBack href="/orders" label={t.order.back} />
        <Notice tone="negative" retry={{ href: `/orders/${id}`, label: t.common.retry }}>
          {t.order.loadFailed}
        </Notice>
      </div>
    );
  }
  if (!order) notFound();

  // The point the customer shared (migration 0032); getOrder gives both coordinates or neither.
  const location =
    order.delivery_lat !== null && order.delivery_lng !== null ? { lat: order.delivery_lat, lng: order.delivery_lng } : null;
  const sourceEntries = Object.entries(order.source ?? {}).filter(([, v]) => typeof v === "string" && v);
  const siteLanguage = isLocale(order.locale) ? t.order.siteLocales[order.locale] : order.locale;
  const sum = (amount: number) => `${formatSum(amount)} ${t.common.currency}`;
  // Who added it by hand: the name kept on its "created" history row (it survives a removed team member).
  const createdEvent = events?.find((event) => event.kind === "created");
  const addedBy = order.created_by
    ? createdEvent?.actor_name
      ? t.order.addedBy(createdEvent.actor_name)
      : t.order.addedByStaff
    : null;

  const edit = canEdit(order.status) ? (
    <Link href={`/orders/${order.id}/edit`} className="adm-btn adm-btn-outline">
      <Pencil aria-hidden="true" />
      <span className="max-[400px]:sr-only">{t.order.edit}</span>
    </Link>
  ) : null;

  return (
    <div className="adm-page">
      <TopBarBack href="/orders" label={t.order.back} />
      {edit && (
        <>
          <TopBarActions>{edit}</TopBarActions>
          {/* The top bar fills only once the scripts run; until then the button sits on the page. */}
          <BeforeHydration>
            <div className="flex justify-end">{edit}</div>
          </BeforeHydration>
        </>
      )}
      <TopBarTitle>
        <span className="adm-truncate">
          {t.order.heading} <span className="tabular-nums">{order.number}</span>
        </span>
        <StatusBadge status={order.status} locale={locale} />
      </TopBarTitle>
      <p className="adm-muted tabular-nums">
        {t.order.createdAt(formatDateTime(order.created_at, locale))} · {t.order.siteLanguage(siteLanguage)}
        {order.updated_at !== order.created_at && <> · {t.order.updatedAt(formatDateTime(order.updated_at, locale))}</>}
        {addedBy && <> · {addedBy}</>}
      </p>

      {/* Phones: the customer, then what to do (status, note), then the details. From xl: details on the left and
          the status column on the right, sticky while the details scroll (main is the scroll container). */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-[auto_1fr]">
        <div className="grid min-w-0 content-start gap-5">
          <Card title={t.order.customer}>
            <p className="text-lg font-semibold text-adm-text">{order.customer_name}</p>
            <p className="mt-1 tabular-nums">{formatPhone(order.phone)}</p>
            <a href={`tel:${order.phone}`} className="adm-btn adm-btn-primary mt-4">
              <Phone aria-hidden="true" />
              {t.order.call}
            </a>
          </Card>
        </div>

        <aside
          aria-label={t.order.status}
          className="grid min-w-0 content-start gap-5 xl:sticky xl:top-6 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start"
        >
          <StatusControls id={order.id} status={order.status} total={sum(order.total)} locale={locale} />
          <NoteForm id={order.id} note={order.staff_note} locale={locale} />
        </aside>

        <div className="grid min-w-0 content-start gap-5 xl:col-start-1 xl:row-start-2">
          <Card title={t.order.programPayment}>
            <Rows
              rows={[
                [t.order.program, `${order.program_name} / ${order.kcal} ${t.common.kcal}`],
                [t.order.deliveryDays, `${order.days}${order.weekdays_only ? t.order.weekdaysOnly : t.order.everyDay}`],
                [t.order.firstDelivery, formatDay(order.start_date, locale)],
                [t.order.pricePerDay, sum(order.price_per_day)],
                [t.order.total, sum(order.total)],
              ]}
            />
            {(canChangePaymentMethod(order.status) || order.payment_method) && (
              <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-[11rem_1fr]">
                <dt className="text-sm text-adm-muted sm:pt-1.5">{t.order.paymentMethod}</dt>
                <dd>
                  {canChangePaymentMethod(order.status) ? (
                    <PaymentMethodControl id={order.id} method={order.payment_method} locale={locale} />
                  ) : (
                    <span className="text-adm-text">
                      {order.payment_method ? t.finance.methods[order.payment_method] : t.order.noPaymentMethod}
                    </span>
                  )}
                </dd>
              </dl>
            )}
            {order.status === "cancelled" && order.cancel_reason && (
              <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-[11rem_1fr]">
                <dt className="text-sm text-adm-muted">{t.order.cancelReason}</dt>
                <dd className="whitespace-pre-line break-words text-adm-text">{order.cancel_reason}</dd>
              </dl>
            )}
            <p className="adm-caption mt-3">{t.order.priceFixed}</p>
          </Card>

          {pauses === null ? (
            <Panel title={t.order.pauses.title}>
              <Notice tone="negative" retry={{ href: `/orders/${order.id}`, label: t.common.retry }}>
                {t.order.pauses.loadFailed}
              </Notice>
            </Panel>
          ) : (
            (canPause(order.status) || pauses.length > 0) && (
              <OrderPauses
                order={{
                  id: order.id,
                  status: order.status,
                  start_date: order.start_date,
                  weekdays_only: order.weekdays_only,
                  days: order.days,
                }}
                pauses={pauses}
                max={pauseMax}
                today={tashkentDay(new Date())!}
                locale={locale}
              />
            )
          )}

          <Card title={t.order.delivery}>
            <Rows
              rows={[
                [t.order.address, order.address],
                [t.order.time, order.delivery_window],
                [t.order.courierComment, order.comment || "—"],
              ]}
            />
            {location && (
              <dl className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-[11rem_1fr]">
                <dt className="text-sm text-adm-muted sm:pt-2">{t.order.location}</dt>
                <dd className="min-w-0">
                  <MapLinks location={location} yandex={t.order.openYandex} google={t.order.openGoogle} />
                  <span className="adm-caption block tabular-nums" data-ph-mask>
                    {formatLocation(location)} · {t.order.locationHint}
                  </span>
                </dd>
              </dl>
            )}
          </Card>

          <Card title={t.order.exclusions}>
            <p className="whitespace-pre-line break-words">{order.exclusions || t.order.noExclusions}</p>
          </Card>

          <Card title={t.order.source}>
            {sourceEntries.length === 0 ? (
              <p className="text-adm-muted">{t.order.noSource}</p>
            ) : (
              <Rows rows={sourceEntries.map(([k, v]) => [k, String(v)])} />
            )}
            {/* An order added in the back office was taken by phone or Telegram: no consent was given on the site. */}
            <p className="adm-caption mt-3">
              {order.created_by ? t.order.takenByStaff : t.order.consent(formatDateTime(order.consent_at, locale))}
            </p>
          </Card>

          <OrderHistory events={events} locale={locale} retryHref={`/orders/${order.id}`} />
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <Panel title={title}>{children}</Panel>;
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[11rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm text-adm-muted">{label}</dt>
          <dd className="whitespace-pre-line break-words text-adm-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
