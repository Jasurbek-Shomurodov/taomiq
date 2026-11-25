import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang, locales } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { DISH_VIEW_COOKIE, foldSearchText, parseDishView } from "@/lib/admin/dish-status";
import { listDishes } from "@/lib/admin/queries";
import { localized } from "@/lib/data/localized";
import type { Dish } from "@/lib/data/types";
import { Notice } from "../../kit/Notice";
import { DishesSkeleton } from "../../kit/Skeleton";
import { TopBarActions } from "../../shell/TopBarSlot";
import { DishesBrowser, type DishListItem } from "./DishesBrowser";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).dishes.title };
}

/**
 * The dishes list. Search (?q=, the names in any language) and the status filter (?status=, as on the overview's
 * dish tiles) run in the browser over the whole catalogue (DishesBrowser); the cards/table choice is a cookie, so
 * the server renders the view the person chose last time.
 */
export default async function DishesPage() {
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  const view = parseDishView((await cookies()).get(DISH_VIEW_COOKIE)?.value);

  let dishes: Dish[] | null = null;
  try {
    dishes = await listDishes(supabase);
  } catch (error) {
    console.error("dishes list failed", error instanceof Error ? error.message : error);
  }

  const addDish = (
    <Link href="/dishes/new" className="adm-btn adm-btn-primary">
      <Plus aria-hidden="true" />
      <span className="max-[400px]:sr-only">{t.dishes.add}</span>
    </Link>
  );

  if (!dishes) {
    return (
      <div className="adm-page">
        <TopBarActions>{addDish}</TopBarActions>
        <Notice tone="negative" retry={{ href: "/dishes", label: t.common.retry }}>
          {t.dishes.loadFailed}
        </Notice>
      </div>
    );
  }

  // listDishes() sorts by the Russian name; sort by the name shown in the panel's language instead.
  const collator = new Intl.Collator(htmlLang[staff.locale]);
  const items: DishListItem[] = dishes
    .map((dish) => ({
      id: dish.id,
      title: localized(dish, "name", staff.locale),
      // The Russian name underneath (or the Latin one for a Russian panel).
      subtitle: staff.locale === "ru" ? dish.name_uz : dish.name_ru,
      search: foldSearchText(locales.map((locale) => localized(dish, "name", locale)).join(" ")),
      photo_url: dish.photo_url || null,
      weight: dish.default_weight_g,
      kcal: Number(dish.kcal_100),
      protein: Number(dish.protein_100),
      fat: Number(dish.fat_100),
      carbs: Number(dish.carbs_100),
      active: dish.active,
      verified: dish.verified,
      archived_at: dish.archived_at ?? null,
    }))
    .sort((a, b) => collator.compare(a.title, b.title));

  return (
    <div className="adm-page">
      <TopBarActions>{addDish}</TopBarActions>
      <Suspense fallback={<DishesSkeleton view={view} />}>
        <DishesBrowser dishes={items} locale={staff.locale} initialView={view} />
      </Suspense>
    </div>
  );
}
