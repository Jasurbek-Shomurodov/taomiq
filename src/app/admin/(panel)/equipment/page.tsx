import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { requireStaff, requireStockAccess } from "@/lib/admin/auth";
import { foldSearchText } from "@/lib/admin/dish-status";
import { countedLine, equipmentPhotoToShow, isEquipmentStatus, type Equipment } from "@/lib/admin/equipment";
import { listEquipment } from "@/lib/admin/equipment-queries";
import { Notice } from "../../kit/Notice";
import { TopBarActions } from "../../shell/TopBarSlot";
import { EquipmentBrowser, type EquipmentListItem } from "./EquipmentBrowser";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).equipment.title };
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Equipment (owners and managers; docs/plans/zarkebab-feature-port.md, slice 13): what the kitchen owns, how many, and
 * who counted last. Loaded whole (a kitchen owns a few hundred things at most) and filtered in the browser: `?q=`
 * searches names and notes, `?status=active|archived` picks the list. Cooks are sent back to the overview.
 */
export default async function EquipmentPage({ searchParams }: PageProps<"/admin/equipment">) {
  const { supabase, staff } = await requireStockAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const te = t.equipment;
  const params = await searchParams;
  const statusParam = one(params.status);

  let equipment: Equipment[] | null = null;
  try {
    equipment = await listEquipment(supabase);
  } catch (error) {
    console.error("equipment list failed", error instanceof Error ? error.message : error);
  }

  const addLink = (
    <Link href="/equipment/new" className="adm-btn adm-btn-primary">
      <Plus aria-hidden="true" />
      <span className="max-[400px]:sr-only">{te.add}</span>
    </Link>
  );

  if (!equipment) {
    return (
      <div className="adm-page">
        <TopBarActions>{addLink}</TopBarActions>
        <Notice tone="negative" retry={{ href: "/equipment", label: t.common.retry }}>
          {te.loadFailed}
        </Notice>
      </div>
    );
  }

  const collator = new Intl.Collator(htmlLang[locale]);
  const items: EquipmentListItem[] = equipment
    .map((item) => ({
      id: item.id,
      name: item.name,
      count: item.count,
      note: item.note,
      // Only a file of this project's equipment bucket is ever rendered.
      photo: equipmentPhotoToShow(item.photo_url),
      counted: countedLine(item, t, locale),
      search: foldSearchText(`${item.name} ${item.note}`),
      archived: item.archived_at !== null,
    }))
    .sort((a, b) => collator.compare(a.name, b.name));

  return (
    <div className="adm-page">
      <TopBarActions>{addLink}</TopBarActions>
      <p className="adm-muted">{te.lead}</p>
      <EquipmentBrowser
        items={items}
        initial={{
          q: one(params.q).slice(0, 80),
          status: isEquipmentStatus(statusParam) ? statusParam : "active",
        }}
        locale={locale}
      />
    </div>
  );
}
