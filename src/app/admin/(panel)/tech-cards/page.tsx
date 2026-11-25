import { CircleCheck, ClipboardList, Coins, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, htmlLang, locales } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { foldSearchText } from "@/lib/admin/dish-status";
import { listDishes } from "@/lib/admin/queries";
import { canHandleStock } from "@/lib/admin/roles";
import { loadDishCosts, loadRecipeOverview } from "@/lib/admin/tech-card-queries";
import type { DishCost, RecipeOverview } from "@/lib/admin/tech-cards";
import { localized } from "@/lib/data/localized";
import type { Dish } from "@/lib/data/types";
import { Notice } from "../../kit/Notice";
import { PageSkeleton } from "../../kit/Skeleton";
import { StatTile } from "../../kit/StatTile";
import { TechCardsBrowser, type TechCardItem } from "./TechCardsBrowser";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).techCards.title };
}

const DASH = "—";

/**
 * Kitchen & stock → Tech cards (docs/plans/zarkebab-feature-port.md, slice 7): every dish in use and its recipe. Every
 * staff member opens it: cooks see whether a dish has a recipe and read it; owners and managers also see the cost of a
 * batch, per 100 g and per portion (public.dish_costs, migration 0023), never shown to a cook. Archived dishes are not
 * listed. Search and the ready / not complete filter run in the browser over the whole list; ticked cards print
 * together (/tech-cards/print).
 */
export default async function TechCardsPage() {
  const { supabase, staff } = await requireStaff();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const tc = t.techCards;
  const stock = canHandleStock(staff.role);

  const [dishesResult, overviewResult, costsResult] = await Promise.allSettled([
    listDishes(supabase),
    loadRecipeOverview(supabase),
    stock ? loadDishCosts(supabase) : Promise.resolve(null),
  ]);
  for (const [what, result] of [
    ["dishes", dishesResult],
    ["overview", overviewResult],
    ["costs", costsResult],
  ] as const) {
    if (result.status === "rejected") {
      console.error(`tech cards: ${what} failed`, result.reason instanceof Error ? result.reason.message : result.reason);
    }
  }
  if (dishesResult.status === "rejected" || overviewResult.status === "rejected") {
    return (
      <div className="adm-page">
        <Notice tone="negative" retry={{ href: "/tech-cards", label: t.common.retry }}>
          {tc.loadFailed}
        </Notice>
      </div>
    );
  }
  const dishes: Dish[] = dishesResult.value.filter((dish) => !dish.archived_at);
  const overview: Map<string, RecipeOverview> = overviewResult.value;
  const costs: Map<string, DishCost> | null = costsResult.status === "fulfilled" ? costsResult.value : null;

  const collator = new Intl.Collator(htmlLang[locale]);
  const items: TechCardItem[] = dishes
    .map((dish) => {
      const recipe = overview.get(dish.id);
      const cost = costs?.get(dish.id) ?? null;
      // Owners and managers see the cost state; without it (a failed read) and for the kitchen, the recipe state.
      const state = stock && costs !== null ? (cost?.state ?? "none") : (recipe?.state ?? "none");
      return {
        id: dish.id,
        title: localized(dish, "name", locale),
        subtitle: locale === "ru" ? dish.name_uz : dish.name_ru,
        search: foldSearchText(locales.map((l) => localized(dish, "name", l)).join(" ")),
        state,
        recipeReady: recipe?.state === "ready",
        lines: recipe?.lines ?? 0,
        batchOutputG: recipe?.batchOutputG ?? null,
        weight: dish.default_weight_g,
        verified: dish.verified,
        cost100: cost?.cost100 ?? null,
        costPortion: cost?.costPortion ?? null,
      };
    })
    .sort((a, b) => collator.compare(a.title, b.title));

  const total = items.length;
  const ready = items.filter((item) => (stock ? item.state === "ok" : item.recipeReady)).length;
  // (With the costs missing, the two cost tiles print "—": the recipe state is no stand-in for a known cost.)
  const known = items.map((item) => item.cost100).filter((value): value is number => value !== null);
  const avg100 = known.length > 0 ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;

  return (
    <div className="adm-page">
      <p className="adm-muted">{stock ? tc.lead : tc.leadKitchen}</p>
      {stock && costs === null && (
        <Notice tone="caution" retry={{ href: "/tech-cards", label: t.common.retry }}>
          {tc.costsFailed}
        </Notice>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile label={tc.tiles.dishes} value={total} icon={ClipboardList} />
        <StatTile
          label={stock ? tc.tiles.complete : tc.tiles.withRecipe}
          value={stock && costs === null ? DASH : ready}
          icon={CircleCheck}
          tone="positive"
        />
        <StatTile
          label={stock ? tc.tiles.needSetup : tc.tiles.withoutRecipe}
          value={stock && costs === null ? DASH : total - ready}
          icon={TriangleAlert}
          tone={total - ready > 0 ? "caution" : "accent"}
        />
        {stock && (
          <StatTile
            label={tc.tiles.avg100}
            value={avg100 === null ? DASH : sum(avg100)}
            icon={Coins}
            footer={known.length > 0 ? tc.tiles.avg100Of(known.length) : tc.tiles.avg100None}
          />
        )}
      </div>

      <Suspense fallback={<PageSkeleton layout="table" />}>
        <TechCardsBrowser items={items} stock={stock && costs !== null} locale={locale} />
      </Suspense>
    </div>
  );
}
