import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { requireOrdersAccess, requireStaff } from "@/lib/admin/auth";
import { canEdit, canEditSchedule, type Order } from "@/lib/admin/orders";
import { getOrder } from "@/lib/admin/queries";
import { loadBusinessSettings } from "@/lib/admin/settings-queries";
import { tashkentDay } from "@/lib/admin/stats";
import { Notice } from "../../../../kit/Notice";
import { TopBarBack, TopBarTitle } from "../../../../shell/TopBarSlot";
import { EditOrderForm } from "../../OrderForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).order.edit };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Edit an open order (docs/plans/zarkebab-feature-port.md, slice 2): contact and delivery fields in any open status,
 * the schedule only before the order starts. Program, days and price never change here. Owners and managers.
 */
export default async function EditOrderPage({ params }: PageProps<"/admin/orders/[id]/edit">) {
  const { id } = await params;
  const { supabase, staff } = await requireOrdersAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  if (!UUID_RE.test(id)) notFound();
  // Read the clock only after the session (a request-time read).
  const today = tashkentDay(new Date())!;

  let loaded: { order: Order | null; windows: string[] } | null = null;
  try {
    const [order, settings] = await Promise.all([getOrder(supabase, id), loadBusinessSettings(supabase)]);
    loaded = { order, windows: settings.deliveryWindows };
  } catch (error) {
    console.error("order edit: read failed", error instanceof Error ? error.message : error);
  }

  const back = <TopBarBack href={`/orders/${id}`} label={t.orderForm.backToOrder} />;
  if (!loaded) {
    return (
      <div className="adm-page">
        {back}
        <Notice tone="negative" retry={{ href: `/orders/${id}/edit`, label: t.common.retry }}>
          {t.order.loadFailed}
        </Notice>
      </div>
    );
  }
  const { order, windows } = loaded;
  if (!order) notFound();

  return (
    <div className="adm-page">
      {back}
      <TopBarTitle>
        <span className="adm-truncate">{t.orderForm.editTitle(order.number)}</span>
      </TopBarTitle>
      {canEdit(order.status) ? (
        <EditOrderForm
          order={{
            id: order.id,
            number: order.number,
            updated_at: order.updated_at,
            customer_name: order.customer_name,
            phone: order.phone,
            address: order.address,
            delivery_window: order.delivery_window,
            comment: order.comment,
            exclusions: order.exclusions,
            start_date: order.start_date,
            weekdays_only: order.weekdays_only,
            linked: order.user_id !== null,
          }}
          windows={windows}
          today={today}
          scheduleEditable={canEditSchedule(order, today)}
          locale={locale}
        />
      ) : (
        <Notice tone="info">
          {t.orderForm.errors.notEditable}{" "}
          <Link href={`/orders/${order.id}`} className="underline underline-offset-4">
            {t.orderForm.backToOrder}
          </Link>
        </Notice>
      )}
    </div>
  );
}
