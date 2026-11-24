import { Phone } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, isLocale } from "@/i18n/config";
import { requireOrdersAccess, requireStaff } from "@/lib/admin/auth";
import { formatDateTime, formatDay, formatPhone, type Order } from "@/lib/admin/orders";
import { getOrder } from "@/lib/admin/queries";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";
import { NoteForm, StatusControls } from "../OrderControls";
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
  try {
    order = await getOrder(supabase, id);
  } catch (error) {
    failed = true;
    console.error("order read failed", error instanceof Error ? error.message : error);
  }

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

  const sourceEntries = Object.entries(order.source ?? {}).filter(([, v]) => typeof v === "string" && v);
  const siteLanguage = isLocale(order.locale) ? t.order.siteLocales[order.locale] : order.locale;
  const sum = (amount: number) => `${formatSum(amount)} ${t.common.currency}`;

  return (
    <div className="adm-page">
      <TopBarBack href="/orders" label={t.order.back} />
      <TopBarTitle>
        <span className="adm-truncate">
          {t.order.heading} <span className="tabular-nums">{order.number}</span>
        </span>
        <StatusBadge status={order.status} locale={locale} />
      </TopBarTitle>
      <p className="adm-muted tabular-nums">
        {t.order.createdAt(formatDateTime(order.created_at, locale))} · {t.order.siteLanguage(siteLanguage)}
        {order.updated_at !== order.created_at && <> · {t.order.updatedAt(formatDateTime(order.updated_at, locale))}</>}
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
          <StatusControls id={order.id} status={order.status} locale={locale} />
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
            <p className="adm-caption mt-3">{t.order.priceFixed}</p>
          </Card>

          <Card title={t.order.delivery}>
            <Rows
              rows={[
                [t.order.address, order.address],
                [t.order.time, order.delivery_window],
                [t.order.courierComment, order.comment || "—"],
              ]}
            />
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
            <p className="adm-caption mt-3">{t.order.consent(formatDateTime(order.consent_at, locale))}</p>
          </Card>
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
