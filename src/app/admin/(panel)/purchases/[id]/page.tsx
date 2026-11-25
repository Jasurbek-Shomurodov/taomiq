import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum } from "@/i18n/config";
import { requireStaff, requireStockAccess } from "@/lib/admin/auth";
import { formatEntryDay } from "@/lib/admin/finance/month";
import { formatDateTime } from "@/lib/admin/orders";
import { PURCHASE_BACKDATE_DAYS, isPurchaseDayAllowed, type Purchase } from "@/lib/admin/purchases";
import { tashkentDay } from "@/lib/admin/stats";
import { getPurchase } from "@/lib/admin/stock-queries";
import { Notice } from "../../../kit/Notice";
import { TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";
import { DeletePurchase } from "../DeletePurchase";
import { loadPurchaseFormData, type PurchaseFormData } from "../form-data";
import { PurchaseForm } from "../PurchaseForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).purchases.title };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One receipt (owners and managers): its form, filled in, to change and save again, and "Delete receipt" underneath.
 * A receipt dated in a month that Finance has closed is shown read-only, and so is, for a manager, one dated before
 * the 3-day window of a new receipt (the owner may still change it; public.purchase_save and purchase_delete refuse
 * the manager with too_old). `?saved=1` after an edit says so.
 */
export default async function PurchasePage({ params, searchParams }: PageProps<"/admin/purchases/[id]">) {
  const { id } = await params;
  const { supabase, staff } = await requireStockAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const tp = t.purchases;
  const query = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const today = tashkentDay(new Date())!;

  let purchase: Purchase | null = null;
  let data: PurchaseFormData | null = null;
  let failed = false;
  try {
    [purchase, data] = await Promise.all([getPurchase(supabase, id), loadPurchaseFormData(supabase, t, locale)]);
  } catch (error) {
    failed = true;
    console.error("purchase load failed", error instanceof Error ? error.message : error);
  }
  if (!failed && !purchase) notFound();

  const back = <TopBarBack href="/purchases?tab=history" label={tp.back} />;
  if (failed || !purchase || !data) {
    return (
      <div className="adm-page">
        {back}
        <Notice tone="negative" retry={{ href: `/purchases/${id}`, label: t.common.retry }}>
          {tp.errors.loadFailed}
        </Notice>
      </div>
    );
  }

  const day = formatEntryDay(purchase.day, locale);
  const closed = data.lockedThrough !== null && purchase.day <= data.lockedThrough;
  const tooOld = !closed && staff.role !== "owner" && !isPurchaseDayAllowed(purchase.day, today);
  const readOnly = closed || tooOld;
  const created = formatDateTime(purchase.created_at, locale);
  const edited = purchase.updated_at && purchase.updated_at !== purchase.created_at;
  const summary = `${day} · ${formatSum(purchase.total)} ${t.common.currency} · ${tp.linesCount(purchase.lines.length)}`;

  return (
    <div className="adm-page">
      {back}
      <TopBarTitle>
        <span className="adm-truncate">{tp.receiptTitle(day)}</span>
      </TopBarTitle>
      {query.saved === "1" && <Notice tone="positive">{tp.edited}</Notice>}
      {closed && <Notice tone="info">{tp.closedNotice}</Notice>}
      {tooOld && <Notice tone="info">{tp.tooOldNotice(PURCHASE_BACKDATE_DAYS)}</Notice>}
      <p className="adm-caption">
        {edited ? tp.metaEdited(created, formatDateTime(purchase.updated_at, locale)) : tp.meta(created)}
      </p>
      <PurchaseForm
        // A saved edit changes updated_at, and the form starts again from the saved receipt; nothing else remounts it.
        key={`${purchase.id}:${purchase.updated_at}`}
        purchase={purchase}
        ingredients={data.ingredients}
        categories={data.categories}
        buyers={data.buyers}
        today={today}
        lockedThrough={data.lockedThrough}
        readOnly={readOnly}
        locale={locale}
      />
      {!readOnly && <DeletePurchase id={purchase.id} loadedAt={purchase.updated_at} summary={summary} locale={locale} />}
    </div>
  );
}
