import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { requireStaff, requireStockAccess } from "@/lib/admin/auth";
import type { Ingredient, IngredientCategory } from "@/lib/admin/ingredients";
import { getIngredient, listCategories } from "@/lib/admin/stock-queries";
import { localized } from "@/lib/data/localized";
import { Notice } from "../../../kit/Notice";
import { TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";
import { IngredientArchive, IngredientForm } from "../IngredientForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).ingredients.title };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/ingredients/new` adds an ingredient; `/ingredients/<id>` edits one, with archive or restore underneath. */
export default async function IngredientPage({ params }: PageProps<"/admin/ingredients/[id]">) {
  const { id } = await params;
  const { supabase, staff } = await requireStockAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const ti = t.ingredients;
  if (id !== "new" && !UUID_RE.test(id)) notFound();

  let categories: IngredientCategory[] | null = null;
  let ingredient: Ingredient | null = null;
  let failed = false;
  try {
    const [loadedCategories, loadedIngredient] = await Promise.all([
      listCategories(supabase),
      id === "new" ? Promise.resolve(null) : getIngredient(supabase, id),
    ]);
    categories = loadedCategories;
    ingredient = loadedIngredient;
  } catch (error) {
    failed = true;
    console.error("ingredient load failed", error instanceof Error ? error.message : error);
  }
  if (!failed && id !== "new" && !ingredient) notFound();

  return (
    <div className="adm-page">
      <TopBarBack href="/ingredients" label={ti.back} />
      <TopBarTitle>
        <span className="adm-truncate">{ingredient ? localized(ingredient, "name", locale) : ti.newTitle}</span>
      </TopBarTitle>
      {failed || !categories ? (
        <Notice tone="negative" retry={{ href: `/ingredients/${id}`, label: t.common.retry }}>
          {ti.loadFailed}
        </Notice>
      ) : (
        <>
          {ingredient?.archived_at && <Notice tone="info">{ti.archivedNotice}</Notice>}
          <IngredientForm
            ingredient={ingredient}
            categories={categories.map((c) => ({ id: c.id, name: localized(c, "name", locale) }))}
            locale={locale}
          />
          {ingredient && <IngredientArchive ingredient={ingredient} locale={locale} />}
        </>
      )}
    </div>
  );
}
