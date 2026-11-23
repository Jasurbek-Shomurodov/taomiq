import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatSum, localeNameRu } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { formatDateTime, formatDay, formatPhone, type Order } from "@/lib/admin/orders";
import { getOrder } from "@/lib/admin/queries";
import { NoteForm, StatusControls } from "../OrderControls";
import { StatusBadge } from "../StatusBadge";

export const metadata: Metadata = { title: "Заказ" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  const { supabase } = await requireOwner();
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
        <BackLink />
        <p role="alert" className="mt-6 rounded-2xl border border-danger/30 bg-danger/5 p-6 text-danger">
          Не удалось загрузить заказ. Обновите страницу через минуту.
        </p>
      </div>
    );
  }
  if (!order) notFound();

  const sourceEntries = Object.entries(order.source ?? {}).filter(([, v]) => typeof v === "string" && v);

  return (
    <div className="max-w-5xl">
      <BackLink />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-4xl text-forest">
          Заказ № <span className="tabular-nums">{order.number}</span>
        </h1>
        <StatusBadge status={order.status} />
      </div>
      <p className="mt-1 text-sm text-muted">
        Создан {formatDateTime(order.created_at)} · язык сайта: {localeNameRu[order.locale] ?? order.locale}
        {order.updated_at !== order.created_at && <> · изменён {formatDateTime(order.updated_at)}</>}
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="grid content-start gap-5">
          <Card title="Клиент">
            <p className="text-lg font-semibold text-forest">{order.customer_name}</p>
            <p className="mt-1 tabular-nums">{formatPhone(order.phone)}</p>
            <a href={`tel:${order.phone}`} className="btn btn-forest mt-4 !py-2.5">
              Позвонить
            </a>
          </Card>

          <Card title="Программа и оплата">
            <Rows
              rows={[
                ["Программа", `${order.program_name} / ${order.kcal} ккал`],
                ["Дней доставки", `${order.days}${order.weekdays_only ? ", только будни" : ", каждый день"}`],
                ["Первая доставка", formatDay(order.start_date)],
                ["Цена за день", `${formatSum(order.price_per_day)} сум`],
                ["Итого", `${formatSum(order.total)} сум`],
              ]}
            />
            <p className="mt-3 text-xs text-muted">Цена зафиксирована на момент заказа.</p>
          </Card>

          <Card title="Доставка">
            <Rows
              rows={[
                ["Адрес", order.address],
                ["Время", order.delivery_window],
                ["Комментарий курьеру", order.comment || "—"],
              ]}
            />
          </Card>

          <Card title="Исключения из меню">
            <p className="whitespace-pre-line">{order.exclusions || "Нет"}</p>
          </Card>

          <Card title="Откуда пришёл">
            {sourceEntries.length === 0 ? (
              <p className="text-muted">Без меток</p>
            ) : (
              <Rows rows={sourceEntries.map(([k, v]) => [k, String(v)])} />
            )}
            <p className="mt-3 text-xs text-muted">Согласие на обработку данных: {formatDateTime(order.consent_at)}</p>
          </Card>
        </div>

        <div className="grid content-start gap-5">
          <StatusControls id={order.id} status={order.status} />
          <NoteForm id={order.id} note={order.staff_note} />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/orders" className="text-sm text-muted hover:text-forest">
      ← Все заказы
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
