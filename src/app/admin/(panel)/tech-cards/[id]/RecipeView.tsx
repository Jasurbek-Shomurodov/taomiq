import { ClipboardList, Printer } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { formatDateTime } from "@/lib/admin/orders";
import { formatQuantity } from "@/lib/admin/purchases";
import type { Recipe } from "@/lib/admin/tech-cards";
import { localized } from "@/lib/data/localized";
import { EmptyState } from "../../../kit/EmptyState";
import { Panel } from "../../../kit/Panel";
import { TopBarActions } from "../../../shell/TopBarSlot";

/**
 * A recipe to read (the kitchen's view of a tech card): batch output, ingredients with their quantities, method and
 * notes. Never a price: everything here comes from public.tech_card_recipes (migration 0023).
 */
export function RecipeView({
  dishName,
  recipe,
  portionG,
  locale,
}: {
  dishName: string;
  recipe: Recipe | null;
  portionG: number;
  locale: Locale;
}) {
  const t = getAdminDictionary(locale);
  const tc = t.techCards;

  if (!recipe || recipe.lines.length === 0) {
    return (
      <Panel>
        <EmptyState icon={ClipboardList} title={tc.noRecipeTitle(dishName)}>
          {tc.noRecipeKitchen}
        </EmptyState>
      </Panel>
    );
  }

  return (
    <>
      <TopBarActions>
        <Link href={`/tech-cards/print?id=${recipe.dishId}`} className="adm-btn adm-btn-outline">
          <Printer aria-hidden="true" />
          {tc.print}
        </Link>
      </TopBarActions>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="grid min-w-0 content-start gap-5">
          <Panel flush title={tc.ingredientsTitle} description={tc.forBatch(formatSum(recipe.batchOutputG))}>
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
                    <td className="px-4 py-3 font-medium text-adm-text">{localized(line, "name", locale)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatQuantity(line.milli, locale)} {tc.units[line.unit]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title={tc.methodTitle}>
            {recipe.method ? (
              <p className="whitespace-pre-line break-words text-sm leading-relaxed text-adm-text">{recipe.method}</p>
            ) : (
              <p className="adm-muted">{tc.noMethod}</p>
            )}
          </Panel>
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <Panel title={tc.batchTitle}>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="adm-caption">{tc.batchOutput}</dt>
                <dd className="text-lg font-semibold tabular-nums text-adm-text">
                  {formatSum(recipe.batchOutputG)} {t.common.g}
                </dd>
              </div>
              <div>
                <dt className="adm-caption">{tc.portion}</dt>
                <dd className="tabular-nums text-adm-text">
                  {formatSum(portionG)} {t.common.g}
                </dd>
              </div>
            </dl>
          </Panel>
          {recipe.notes && (
            <Panel title={tc.notesTitle}>
              <p className="whitespace-pre-line break-words text-sm text-adm-text">{recipe.notes}</p>
            </Panel>
          )}
          {recipe.updatedAt && (
            <p className="adm-caption">
              {recipe.updatedByName
                ? tc.updatedBy(formatDateTime(recipe.updatedAt, locale), recipe.updatedByName)
                : tc.updated(formatDateTime(recipe.updatedAt, locale))}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
