import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, htmlLang, locales } from "@/i18n/config";
import { requireStaff, requireStockAccess } from "@/lib/admin/auth";
import { foldSearchText } from "@/lib/admin/dish-status";
import { isIngredientStatus, type Ingredient, type IngredientCategory } from "@/lib/admin/ingredients";
import { listCategories, listIngredients } from "@/lib/admin/stock-queries";
import { localized } from "@/lib/data/localized";
import { Notice } from "../../kit/Notice";
import { TopBarActions } from "../../shell/TopBarSlot";
import { CategoriesPanel, type CategoryRow } from "./CategoriesPanel";
import { IngredientsBrowser, type IngredientListItem } from "./IngredientsBrowser";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).ingredients.title };
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Ingredients (owners and managers; docs/plans/zarkebab-feature-port.md, slice 6): the catalogue the purchases pick
 * from. Loaded whole (a kitchen buys a few hundred things) and filtered in the browser: `?q=` searches the names in
 * any language, `?category=` and `?status=active|archived` filter. The owner also sees the categories underneath.
 */
export default async function IngredientsPage({ searchParams }: PageProps<"/admin/ingredients">) {
  const { supabase, staff } = await requireStockAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const ti = t.ingredients;
  const params = await searchParams;
  const statusParam = one(params.status);

  let ingredients: Ingredient[] | null = null;
  let categories: IngredientCategory[] | null = null;
  const [ingredientsResult, categoriesResult] = await Promise.allSettled([
    listIngredients(supabase),
    listCategories(supabase),
  ]);
  if (ingredientsResult.status === "fulfilled") ingredients = ingredientsResult.value;
  else console.error("ingredients list failed", errorText(ingredientsResult.reason));
  if (categoriesResult.status === "fulfilled") categories = categoriesResult.value;
  else console.error("ingredient categories failed", errorText(categoriesResult.reason));

  const addLink = (
    <Link href="/ingredients/new" className="adm-btn adm-btn-primary">
      <Plus aria-hidden="true" />
      <span className="max-[400px]:sr-only">{ti.add}</span>
    </Link>
  );

  if (!ingredients || !categories) {
    return (
      <div className="adm-page">
        <TopBarActions>{addLink}</TopBarActions>
        <Notice tone="negative" retry={{ href: "/ingredients", label: t.common.retry }}>
          {ti.loadFailed}
        </Notice>
      </div>
    );
  }

  const categoryName = new Map(categories.map((c) => [c.id, localized(c, "name", locale)]));
  const collator = new Intl.Collator(htmlLang[locale]);
  const items: IngredientListItem[] = ingredients
    .map((ingredient) => ({
      id: ingredient.id,
      title: localized(ingredient, "name", locale),
      subtitle: locale === "ru" ? ingredient.name_uz : ingredient.name_ru,
      search: foldSearchText(locales.map((l) => localized(ingredient, "name", l)).join(" ")),
      categoryId: ingredient.category_id,
      category: categoryName.get(ingredient.category_id) ?? "—",
      unit: ti.units[ingredient.unit],
      price:
        ingredient.usual_price === null
          ? null
          : ti.priceText(`${formatSum(ingredient.usual_price)} ${t.common.currency}`, ti.units[ingredient.unit]),
      pieces: ingredient.pieces_per_unit,
      archived: ingredient.archived_at !== null,
    }))
    .sort((a, b) => collator.compare(a.title, b.title));

  const usedBy = new Map<string, number>();
  for (const ingredient of ingredients) {
    if (ingredient.archived_at === null) {
      usedBy.set(ingredient.category_id, (usedBy.get(ingredient.category_id) ?? 0) + 1);
    }
  }
  const categoryRows: CategoryRow[] = categories.map((c) => ({ ...c, used: usedBy.get(c.id) ?? 0 }));

  return (
    <div className="adm-page">
      <TopBarActions>{addLink}</TopBarActions>
      <p className="adm-muted">{ti.lead}</p>
      <IngredientsBrowser
        items={items}
        categories={categories.map((c) => ({ id: c.id, name: categoryName.get(c.id) ?? c.name_ru }))}
        initial={{
          q: one(params.q).slice(0, 80),
          category: categoryName.has(one(params.category)) ? one(params.category) : "",
          status: isIngredientStatus(statusParam) ? statusParam : "active",
        }}
        locale={locale}
      />
      {staff.role === "owner" && <CategoriesPanel categories={categoryRows} locale={locale} />}
    </div>
  );
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
