import { ChefHat, ClipboardList, Scale } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { requireStockAccess } from "@/lib/admin/auth";
import { formatEntryDay } from "@/lib/admin/finance/month";
import { purchasesHref } from "@/lib/admin/purchase-links";
import { formatQuantity } from "@/lib/admin/purchases";
import type { ReportPeriod } from "@/lib/admin/reports";
import { loadIngredientUsage } from "@/lib/admin/tech-card-queries";
import { signedMilli, type IngredientUsage } from "@/lib/admin/tech-cards";
import { localized } from "@/lib/data/localized";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { StatTile } from "../../kit/StatTile";

/**
 * Usage: what the period's receipts bought against what the tech cards say the delivered rations used
 * (public.ingredient_usage, migration 0023). Labelled an estimate everywhere: it is not a stock count, and it is only
 * as good as the cards and the menu. Dishes the estimate could not count are named.
 */
export async function UsageTab({ period, locale }: { period: ReportPeriod; locale: Locale }) {
  const { supabase } = await requireStockAccess();
  const t = getAdminDictionary(locale);
  const tu = t.usage;

  let data: IngredientUsage | null = null;
  try {
    data = await loadIngredientUsage(supabase, period);
  } catch (error) {
    console.error("purchases usage failed", error instanceof Error ? error.message : error);
  }
  if (!data) {
    return (
      <Notice tone="negative" retry={{ href: purchasesHref({ tab: "usage", period }), label: t.common.retry }}>
        {tu.loadFailed}
      </Notice>
    );
  }

  const unit = (u: keyof typeof t.ingredients.units) => t.ingredients.units[u];
  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;

  return (
    <>
      <Notice tone="info">
        {tu.estimate}
        {data.usedTo && data.usedTo < data.to && <> {tu.usedTo(formatEntryDay(data.usedTo, locale))}</>}
      </Notice>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile label={tu.rations} value={formatSum(data.rations)} icon={ChefHat} footer={tu.rationsHint} />
        <StatTile
          label={tu.dishesCounted}
          value={tu.ofTotal(data.countedDishes, data.dishes)}
          icon={ClipboardList}
          tone={data.countedDishes < data.dishes ? "caution" : "accent"}
        />
        <StatTile label={tu.ingredients} value={formatSum(data.rows.length)} icon={Scale} />
      </div>

      {data.noMenuRations > 0 && <Notice tone="caution">{t.shopping.noMenu(data.noMenuRations)}</Notice>}
      {data.uncounted.length > 0 && (
        <Notice tone="caution">
          <strong className="block font-semibold">{tu.uncounted(data.uncounted.length)}</strong>
          {data.uncounted.map((dish) => (
            <span key={dish.dishId} className="mt-1 block font-normal">
              <Link href={`/tech-cards/${dish.dishId}`} className="font-semibold underline underline-offset-4">
                {localized(dish, "name", locale) || t.kitchen.unknownDish}
              </Link>{" "}
              · {t.shopping.reasons[dish.state]} · {t.kitchen.portions(dish.portions)}
            </span>
          ))}
        </Notice>
      )}

      {data.rows.length === 0 ? (
        <Panel>
          <EmptyState icon={Scale}>{tu.empty}</EmptyState>
        </Panel>
      ) : (
        <Panel title={tu.title} description={tu.lead} flush className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="adm-table-head">
              <tr>
                <th className="px-4 py-2.5 font-medium">{tu.columns.ingredient}</th>
                <th className="px-4 py-2.5 text-right font-medium">{tu.columns.bought}</th>
                <th className="px-4 py-2.5 text-right font-medium">{tu.columns.used}</th>
                <th className="px-4 py-2.5 text-right font-medium">{tu.columns.diff}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const diff = signedMilli(row.diffMilli);
                const tone =
                  row.usedMilli === 0 || row.boughtMilli === 0
                    ? "text-adm-muted"
                    : row.diffMilli < 0
                      ? "text-adm-caution"
                      : "text-adm-text";
                return (
                  <tr key={row.ingredientId} className="adm-row">
                    <td className="px-4 py-3">
                      <Link href={`/ingredients/${row.ingredientId}`} className="font-semibold text-adm-text hover:underline">
                        {localized(row, "name", locale)}
                      </Link>
                      {row.otherUnits && <span className="adm-caption block">{tu.otherUnits}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatQuantity(row.boughtMilli, locale)} {unit(row.unit)}
                      {row.boughtAmount > 0 && <span className="adm-caption block">{sum(row.boughtAmount)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatQuantity(row.usedMilli, locale)} {unit(row.unit)}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${tone}`}>
                      {diff.sign}
                      {formatQuantity(diff.abs, locale)} {unit(row.unit)}
                      <span className="adm-caption block font-normal">
                        {row.diffMilli > 0 ? tu.moreBought : row.diffMilli < 0 ? tu.moreUsed : tu.even}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
