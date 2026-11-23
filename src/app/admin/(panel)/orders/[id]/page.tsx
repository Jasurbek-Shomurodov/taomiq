import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, isLocale } from "@/i18n/config";
import { requireOwner, requireStaff } from "@/lib/admin/auth";
import { formatDateTime, formatDay, formatPhone, type Order } from "@/lib/admin/orders";
import { getOrder } from "@/lib/admin/queries";
import { NoteForm, StatusControls } from "../OrderControls";
import { StatusBadge } from "../StatusBadge";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).order.title };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  const { supabase, staff } = await requireOwner();
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
      <div className="max-w-5xl">
        <BackLink label={t.order.back} />
        <p role="alert" className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-6 text-danger">
          {t.order.loadFailed}
        </p>
      </div>
    );
  }
  if (!order) notFound();

  const sourceEntries = Object.entries(order.source ?? {}).filter(([, v]) => typeof v === "string" && v);
  const siteLanguage = isLocale(order.locale) ? t.order.siteLocales[order.locale] : order.locale;
  const sum = (amount: number) => `${formatSum(amount)} ${t.common.currency}`;

  return (
    <div className="max-w-5xl">
      <BackLink label={t.order.back} />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl text-forest">
          {t.order.heading} <span className="tabular-nums">{order.number}</span>
        </h1>
        <StatusBadge status={order.status} locale={locale} />
      </div>
      <p className="mt-1 text-sm text-muted">
        {t.order.createdAt(formatDateTime(order.created_at, locale))} · {t.order.siteLanguage(siteLanguage)}
        {order.updated_at !== order.created_at && <> · {t.order.updatedAt(formatDateTime(order.updated_at, locale))}</>}
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-5">
          <Card title={t.order.customer}>
            <p className="text-lg font-semibold text-forest">{order.customer_name}</p>
            <p className="mt-1 tabular-nums">{formatPhone(order.phone)}</p>
            <a href={`tel:${order.phone}`} className="btn btn-forest mt-4 !py-2.5">
              {t.order.call}
            </a>
          </Card>

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
            <p className="mt-3 text-xs text-muted">{t.order.priceFixed}</p>
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
            <p className="whitespace-pre-line">{order.exclusions || t.order.noExclusions}</p>
          </Card>

          <Card title={t.order.source}>
            {sourceEntries.length === 0 ? (
              <p className="text-muted">{t.order.noSource}</p>
            ) : (
              <Rows rows={sourceEntries.map(([k, v]) => [k, String(v)])} />
            )}
            <p className="mt-3 text-xs text-muted">{t.order.consent(formatDateTime(order.consent_at, locale))}</p>
          </Card>
        </div>

        <div className="grid content-start gap-5">
          <StatusControls id={order.id} status={order.status} locale={locale} />
          <NoteForm id={order.id} note={order.staff_note} locale={locale} />
        </div>
      </div>
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link href="/orders" className="text-sm text-muted hover:text-forest">
      {label}
    </Link>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h2 className="label text-muted">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[11rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm text-muted">{label}</dt>
          <dd className="whitespace-pre-line break-words text-graphite">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
