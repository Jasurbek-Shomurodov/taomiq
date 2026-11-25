import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { requireStaff, requireStockAccess } from "@/lib/admin/auth";
import { countedLine, equipmentPhotoToShow, type Equipment, type EquipmentEvent } from "@/lib/admin/equipment";
import { getEquipment, listEquipmentEvents } from "@/lib/admin/equipment-queries";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";
import { CountControl } from "../CountControl";
import { EquipmentArchive, EquipmentForm } from "../EquipmentForm";
import { EquipmentHistory } from "../EquipmentHistory";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).equipment.title };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/equipment/new` adds an item; `/equipment/<id>` edits one: the editor (name, note, photo) and archive or restore on
 * the left, the count and its history on the right.
 */
export default async function EquipmentItemPage({ params }: PageProps<"/admin/equipment/[id]">) {
  const { id } = await params;
  const { supabase, staff } = await requireStockAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const te = t.equipment;
  if (id !== "new" && !UUID_RE.test(id)) notFound();

  let item: Equipment | null = null;
  let events: EquipmentEvent[] | null = null;
  let failed = false;
  if (id !== "new") {
    const [itemResult, eventsResult] = await Promise.allSettled([
      getEquipment(supabase, id),
      listEquipmentEvents(supabase, id),
    ]);
    if (itemResult.status === "fulfilled") item = itemResult.value;
    else {
      failed = true;
      console.error("equipment load failed", errorText(itemResult.reason));
    }
    // A failed history read leaves the item usable (its panel says so).
    if (eventsResult.status === "fulfilled") events = eventsResult.value;
    else console.error("equipment history read failed", errorText(eventsResult.reason));
    if (!failed && !item) notFound();
  }

  return (
    <div className="adm-page">
      <TopBarBack href="/equipment" label={te.back} />
      <TopBarTitle>
        <span className="adm-truncate">{item ? item.name : te.newTitle}</span>
      </TopBarTitle>
      {failed ? (
        <Notice tone="negative" retry={{ href: `/equipment/${id}`, label: t.common.retry }}>
          {te.loadFailed}
        </Notice>
      ) : !item ? (
        <EquipmentForm item={null} shownPhoto={null} locale={locale} />
      ) : (
        <>
          {item.archived_at && <Notice tone="info">{te.archivedNotice}</Notice>}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
            <div className="grid min-w-0 content-start gap-5">
              <EquipmentForm item={item} shownPhoto={equipmentPhotoToShow(item.photo_url)} locale={locale} />
              <EquipmentArchive item={item} locale={locale} />
            </div>
            <div className="grid min-w-0 content-start gap-5">
              <Panel title={te.countTitle} description={countedLine(item, t, locale)}>
                {item.archived_at ? (
                  <p className="tabular-nums text-adm-text">
                    <b className="text-2xl font-semibold">{item.count}</b>
                    <span className="adm-caption block">{te.countArchivedHint}</span>
                  </p>
                ) : (
                  <CountControl id={item.id} name={item.name} count={item.count} locale={locale} />
                )}
              </Panel>
              <EquipmentHistory events={events} locale={locale} retryHref={`/equipment/${item.id}`} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
