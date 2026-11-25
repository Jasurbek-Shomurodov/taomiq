import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { listDishes } from "@/lib/admin/queries";
import { canHandleStock } from "@/lib/admin/roles";
import { listCategories, listIngredients } from "@/lib/admin/stock-queries";
import { loadCostPreview, loadDishCosts, loadRecipeOverview, loadRecipes } from "@/lib/admin/tech-card-queries";
import {
  draftFromLine,
  previewPayload,
  type CostPreview,
  type CostState,
  type Recipe,
} from "@/lib/admin/tech-cards";
import { localized } from "@/lib/data/localized";
import type { Dish } from "@/lib/data/types";
import { Notice } from "../../../kit/Notice";
import { TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";
import { formIngredient, type FormIngredient } from "../../purchases/form-ingredient";
import { RecipeView } from "./RecipeView";
import { TechCardEditor } from "./TechCardEditor";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).techCards.cardTitle };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * One dish's tech card (`/tech-cards/<dish id>`). Owners and managers edit it (TechCardEditor) and see what it costs,
 * worked out by the database (public.tech_card_cost_preview); everyone else reads the recipe (RecipeView), which
 * comes from public.tech_card_recipes and carries no price. `?saved=1` after a save.
 */
export default async function TechCardPage({ params, searchParams }: PageProps<"/admin/tech-cards/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, staff } = await requireStaff();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const tc = t.techCards;
  const stock = canHandleStock(staff.role);
  if (!UUID_RE.test(id)) notFound();

  const { data: dishRow, error: dishError } = await supabase.from("dishes").select("*").eq("id", id).maybeSingle();
  if (dishError) {
    console.error("tech card: dish read failed", dishError.code);
    return <Failed href={`/tech-cards/${id}`} message={tc.loadFailed} retry={t.common.retry} back={tc.back} />;
  }
  if (!dishRow) notFound();
  const dish = dishRow as Dish;
  const name = localized(dish, "name", locale);

  let recipe: Recipe | null = null;
  try {
    recipe = (await loadRecipes(supabase, [id])).get(id) ?? null;
  } catch (error) {
    console.error("tech card: recipe read failed", error instanceof Error ? error.message : error);
    return <Failed href={`/tech-cards/${id}`} message={tc.loadFailed} retry={t.common.retry} back={tc.back} />;
  }

  const head = (
    <>
      <TopBarBack href="/tech-cards" label={tc.back} />
      <TopBarTitle>
        <span className="adm-truncate">{name}</span>
      </TopBarTitle>
    </>
  );

  if (!stock) {
    return (
      <div className="adm-page">
        {head}
        {dish.verified && !recipe?.lines.length && <Notice tone="caution">{tc.verifiedHint}</Notice>}
        <RecipeView dishName={name} recipe={recipe} portionG={dish.default_weight_g} locale={locale} />
      </div>
    );
  }

  // The editor: the catalogue (pickers hide archived ingredients themselves), the saved card's state, the live cost of
  // the saved lines, and the dishes a recipe can be copied from.
  const [ingredientsResult, categoriesResult, costsResult, overviewResult, dishesResult] = await Promise.allSettled([
    listIngredients(supabase),
    listCategories(supabase),
    loadDishCosts(supabase),
    loadRecipeOverview(supabase),
    listDishes(supabase),
  ]);
  if (ingredientsResult.status === "rejected" || categoriesResult.status === "rejected") {
    const reason = ingredientsResult.status === "rejected" ? ingredientsResult.reason : (categoriesResult as PromiseRejectedResult).reason;
    console.error("tech card: catalogue read failed", reason instanceof Error ? reason.message : reason);
    return <Failed href={`/tech-cards/${id}`} message={tc.loadFailed} retry={t.common.retry} back={tc.back} />;
  }
  const categoryNames = new Map(categoriesResult.value.map((c) => [c.id, localized(c, "name", locale)]));
  const collator = new Intl.Collator(htmlLang[locale]);
  const ingredients: FormIngredient[] = ingredientsResult.value
    .map((ingredient) => formIngredient(ingredient, categoryNames.get(ingredient.category_id) ?? "—", t, locale))
    .sort((a, b) => collator.compare(a.name, b.name));
  const unitOf = (ingredientId: string) => ingredients.find((i) => i.id === ingredientId)?.unit ?? null;

  const savedState: CostState | null =
    costsResult.status === "fulfilled" ? (costsResult.value.get(id)?.state ?? "none") : null;

  let initialPreview: CostPreview | null = null;
  const drafts = (recipe?.lines ?? []).map((line) => draftFromLine(line, unitOf));
  const payload = previewPayload(drafts, unitOf);
  try {
    initialPreview = await loadCostPreview(supabase, {
      batchOutputG: recipe?.batchOutputG ?? null,
      portionG: dish.default_weight_g,
      lines: payload.map((p) => p.line),
    });
  } catch (error) {
    // The editor asks again on its own; the figures say "—" until then.
    console.error("tech card: cost preview failed", error instanceof Error ? error.message : error);
  }

  const copySources =
    overviewResult.status === "fulfilled" && dishesResult.status === "fulfilled"
      ? dishesResult.value
          .filter((other) => other.id !== id && overviewResult.value.get(other.id)?.state === "ready")
          .map((other) => ({ id: other.id, name: localized(other, "name", locale) }))
          .sort((a, b) => collator.compare(a.name, b.name))
      : null;

  return (
    <div className="adm-page">
      {head}
      {one(query.saved) === "1" && <Notice tone="positive">{tc.saved}</Notice>}
      {dish.archived_at && <Notice tone="info">{tc.dishArchived}</Notice>}
      {dish.verified && savedState !== null && savedState !== "ok" && (
        <Notice tone="caution">
          {tc.verifiedHint}{" "}
          <Link href={`/dishes/${id}`} className="font-semibold underline underline-offset-4">
            {tc.toDish}
          </Link>
        </Notice>
      )}
      <TechCardEditor
        // A save goes to ?saved=1 with a new updated_at: the editor starts again from the saved card.
        key={recipe?.updatedAt ?? "new"}
        dish={{ id, name, portionG: dish.default_weight_g }}
        recipe={recipe}
        ingredients={ingredients}
        initialPreview={initialPreview}
        copySources={copySources}
        locale={locale}
      />
    </div>
  );
}

function Failed({ href, message, retry, back }: { href: string; message: string; retry: string; back: string }) {
  return (
    <div className="adm-page">
      <TopBarBack href="/tech-cards" label={back} />
      <Notice tone="negative" retry={{ href, label: retry }}>
        {message}
      </Notice>
    </div>
  );
}
