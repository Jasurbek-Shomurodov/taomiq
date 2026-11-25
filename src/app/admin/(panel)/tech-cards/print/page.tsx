import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { formatDateTime } from "@/lib/admin/orders";
import { formatQuantity } from "@/lib/admin/purchases";
import { canHandleStock } from "@/lib/admin/roles";
import { loadDishCosts, loadRecipes } from "@/lib/admin/tech-card-queries";
import type { DishCost, Recipe } from "@/lib/admin/tech-cards";
import { localized } from "@/lib/data/localized";
import type { Dish } from "@/lib/data/types";
import { EmptyState } from "../../../kit/EmptyState";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { PrintButton, PrintTime } from "../../../kit/PrintButton";
import { TopBarActions, TopBarBack, TopBarTitle } from "../../../shell/TopBarSlot";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).techCards.printTitle };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CARDS = 300;

function many(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/**
 * Tech cards on paper (`/tech-cards/print?id=…&id=…`, optional `&cost=1`): name, batch output, ingredients and method
 * of each chosen dish, one block per card that is never split across pages (the print styles of admin.css). The cost
 * of a batch, per 100 g and per portion is printed only when asked for (`cost=1`) and only for owners and managers
 * (public.dish_costs refuses anyone else).
 */
export default async function TechCardsPrintPage({ searchParams }: PageProps<"/admin/tech-cards/print">) {
  const { supabase, staff } = await requireStaff();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const tc = t.techCards;
  const params = await searchParams;
  const now = new Date();
  const ids = [...new Set(many(params.id).filter((id) => UUID_RE.test(id)))].slice(0, MAX_CARDS);
  const withCost = canHandleStock(staff.role) && many(params.cost)[0] === "1";

  const head = (
    <>
      <TopBarBack href="/tech-cards" label={tc.back} />
      <TopBarTitle>{tc.printTitle}</TopBarTitle>
    </>
  );

  if (ids.length === 0) {
    return (
      <div className="adm-page">
        {head}
        <Panel>
          <EmptyState
            icon={ClipboardList}
            action={
              <Link href="/tech-cards" className="adm-btn adm-btn-outline">
                {tc.back}
              </Link>
            }
          >
            {tc.printNone}
          </EmptyState>
        </Panel>
      </div>
    );
  }

  let dishes: Dish[];
  let recipes: Map<string, Recipe>;
  let costs: Map<string, DishCost> | null = null;
  try {
    const { data, error } = await supabase.from("dishes").select("*").in("id", ids);
    if (error) throw new Error(`dishes: ${error.code} ${error.message}`);
    dishes = (data ?? []) as Dish[];
    recipes = await loadRecipes(supabase, ids);
  } catch (error) {
    console.error("tech cards print: read failed", error instanceof Error ? error.message : error);
    return (
      <div className="adm-page">
        {head}
        <Notice tone="negative" retry={{ href: `/tech-cards/print?${ids.map((id) => `id=${id}`).join("&")}`, label: t.common.retry }}>
          {tc.loadFailed}
        </Notice>
      </div>
    );
  }
  if (withCost) {
    try {
      costs = await loadDishCosts(supabase);
    } catch (error) {
      console.error("tech cards print: costs failed", error instanceof Error ? error.message : error);
    }
  }

  const byId = new Map(dishes.map((dish) => [dish.id, dish]));
  const ordered = ids.map((id) => byId.get(id)).filter((dish): dish is Dish => dish !== undefined);
  const withRecipe = ordered.filter((dish) => (recipes.get(dish.id)?.lines.length ?? 0) > 0);
  const without = ordered.filter((dish) => (recipes.get(dish.id)?.lines.length ?? 0) === 0);
  const sum = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : `${formatSum(value)} ${t.common.currency}`;

  return (
    <div className="adm-page adm-sheet">
      {head}
      <TopBarActions>
        <PrintButton label={tc.print} />
      </TopBarActions>

      <p className="adm-print-only adm-print-header">
        <strong>TAOMIQ</strong> · {tc.printTitle} · {tc.printCount(withRecipe.length)} · {t.kitchen.printed}{" "}
        <PrintTime initial={formatDateTime(now.toISOString(), locale)} locale={locale} />
      </p>

      {without.length > 0 && (
        <Notice tone="caution">{tc.printWithout(without.map((dish) => localized(dish, "name", locale)).join(", "))}</Notice>
      )}
      {withCost && costs === null && <Notice tone="caution">{tc.costsFailed}</Notice>}

      {withRecipe.map((dish) => {
        const recipe = recipes.get(dish.id)!;
        const cost = costs?.get(dish.id) ?? null;
        return (
          <Panel
            key={dish.id}
            flush
            className="adm-techcard"
            title={localized(dish, "name", locale)}
            description={
              <span className="tabular-nums">
                {tc.forBatch(formatSum(recipe.batchOutputG))} · {tc.portionOf(dish.default_weight_g)}
              </span>
            }
          >
            <table className="w-full text-left text-sm">
              <thead className="adm-table-head">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{tc.columns.ingredient}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{tc.columns.quantity}</th>
                </tr>
              </thead>
              <tbody>
                {recipe.lines.map((line) => (
                  <tr key={line.ingredientId} className="adm-row">
                    <td className="px-4 py-2.5 text-adm-text">{localized(line, "name", locale)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                      {formatQuantity(line.milli, locale)} {tc.units[line.unit]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-3 px-4 py-4 sm:px-5">
              <div>
                <h3 className="text-sm font-semibold text-adm-text">{tc.methodTitle}</h3>
                <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-adm-text">
                  {recipe.method || tc.noMethod}
                </p>
              </div>
              {recipe.notes && (
                <div>
                  <h3 className="text-sm font-semibold text-adm-text">{tc.notesTitle}</h3>
                  <p className="mt-1 whitespace-pre-line break-words text-sm text-adm-text">{recipe.notes}</p>
                </div>
              )}
              {withCost && costs !== null && (
                <p className="text-sm tabular-nums text-adm-text">
                  {cost?.state === "ok"
                    ? tc.printCost(sum(cost.batchCost), sum(cost.cost100), sum(cost.costPortion))
                    : tc.printNoCost}
                </p>
              )}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
