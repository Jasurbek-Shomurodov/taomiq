import { Filter, Plus, UtensilsCrossed, X } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { isDishStatusFilter, matchesDishStatus } from "@/lib/admin/dish-status";
import { listDishes } from "@/lib/admin/queries";
import { localized } from "@/lib/data/localized";
import { Badge } from "../../kit/Badge";
import { EmptyState } from "../../kit/EmptyState";
import { Panel } from "../../kit/Panel";
import { TopBarActions } from "../../shell/TopBarSlot";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).dishes.title };
}

export default async function DishesPage({ searchParams }: PageProps<"/admin/dishes">) {
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  // ?status= from the overview's dish tiles (lib/admin/dish-status.ts); an unknown value is no filter. Slice 3 of
  // docs/plans/admin-portal-upgrade.md replaces this line with the full toolbar.
  const { status: statusParam } = await searchParams;
  const filter = typeof statusParam === "string" && isDishStatusFilter(statusParam) ? statusParam : null;
  // listDishes() sorts by the Russian name; sort by the name shown in the panel's language instead.
  const collator = new Intl.Collator(htmlLang[staff.locale]);
  const dishes = (await listDishes(supabase))
    .map((dish) => ({ ...dish, title: localized(dish, "name", staff.locale) }))
    .sort((a, b) => collator.compare(a.title, b.title));
  const shown = filter ? dishes.filter((dish) => matchesDishStatus(dish, filter)) : dishes;

  const addDish = (
    <Link href="/dishes/new" className="adm-btn adm-btn-primary">
      <Plus aria-hidden="true" />
      <span className="max-[400px]:sr-only">{t.dishes.add}</span>
    </Link>
  );

  return (
    <div className="adm-page">
      <TopBarActions>{addDish}</TopBarActions>

      {filter && dishes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge tone="info" icon={<Filter aria-hidden="true" />}>
            {t.dishes.filterOn}: {t.dishes.filters[filter]}
          </Badge>
          <span className="adm-caption tabular-nums">{t.dishes.count(shown.length)}</span>
          <Link href="/dishes" className="adm-btn adm-btn-ghost adm-btn-sm">
            <X aria-hidden="true" />
            {t.dishes.clearFilter}
          </Link>
        </div>
      )}

      {dishes.length === 0 ? (
        <Panel>
          <EmptyState icon={UtensilsCrossed} action={addDish}>
            {t.dishes.empty}
          </EmptyState>
        </Panel>
      ) : shown.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Filter}
            action={
              <Link href="/dishes" className="adm-btn adm-btn-outline">
                {t.dishes.clearFilter}
              </Link>
            }
          >
            {t.dishes.filteredEmpty}
          </EmptyState>
        </Panel>
      ) : (
        <Panel flush className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="adm-table-head">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t.dishes.dish}</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">{t.dishes.portion}</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">{t.dishes.kcal100}</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">{t.dishes.pfc}</th>
                <th className="px-4 py-2.5 font-medium">{t.dishes.status}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((dish) => (
                <tr key={dish.id} className="adm-row">
                  <td className="px-4 py-3">
                    <Link href={`/dishes/${dish.id}`} className="flex items-center gap-3">
                      <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-adm-surface-muted">
                        {dish.photo_url && (
                          <Image src={dish.photo_url} alt="" fill sizes="44px" className="object-cover" />
                        )}
                      </span>
                      <span>
                        {/* The name in the panel's language, with the Russian one underneath (or the Latin one for Russian). */}
                        <span className="block font-semibold text-adm-text">{dish.title}</span>
                        <span className="block text-[13px] text-adm-muted">
                          {staff.locale === "ru" ? dish.name_uz : dish.name_ru}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{dish.default_weight_g}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{Number(dish.kcal_100)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-adm-muted">
                    {Number(dish.protein_100)} / {Number(dish.fat_100)} / {Number(dish.carbs_100)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {!dish.active && <Badge tone="neutral">{t.dishes.hidden}</Badge>}
                      {dish.verified ? (
                        <Badge tone="positive">{t.dishes.verified}</Badge>
                      ) : (
                        <Badge tone="caution">{t.dishes.noCard}</Badge>
                      )}
                      {!dish.photo_url && <Badge tone="caution">{t.dishes.noPhoto}</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
