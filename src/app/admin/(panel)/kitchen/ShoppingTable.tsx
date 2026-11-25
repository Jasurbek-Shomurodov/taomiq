import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, htmlLang, type Locale } from "@/i18n/config";
import { formatQuantity } from "@/lib/admin/purchases";
import type { ShoppingLine, ShoppingList, UncountedDish } from "@/lib/admin/tech-cards";
import { localized } from "@/lib/data/localized";
import { Notice } from "../../kit/Notice";

/**
 * The shopping list's ingredients, grouped by category: name and quantity in the unit it is bought in, and (only in
 * the costed list, for owners and managers) the usual price and the amount. Shared by the kitchen page's block and the
 * print view (/kitchen/shopping).
 */
export function ShoppingTable({ list, costed, locale }: { list: ShoppingList; costed: boolean; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const ts = t.shopping;
  const groups: { id: string; name: string; lines: ShoppingLine[] }[] = [];
  for (const line of list.lines) {
    const last = groups[groups.length - 1];
    if (last && last.id === line.categoryId) last.lines.push(line);
    else groups.push({ id: line.categoryId, name: localized(line.category, "name", locale), lines: [line] });
  }
  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;
  const cols = costed ? 3 : 2;

  return (
    <table className="w-full text-left text-sm">
      <thead className="adm-table-head">
        <tr>
          <th className="px-3 py-2.5 font-medium sm:px-4">{ts.ingredient}</th>
          <th className="px-3 py-2.5 text-right font-medium sm:px-4">{ts.quantity}</th>
          {costed && <th className="px-3 py-2.5 text-right font-medium sm:px-4">{ts.amount}</th>}
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.id} className="adm-sheet-dish border-b border-adm-hairline">
          <tr>
            <th scope="rowgroup" colSpan={cols} className="adm-caption bg-adm-surface-muted px-3 py-2 font-semibold sm:px-4">
              {group.name}
            </th>
          </tr>
          {group.lines.map((line) => (
            <tr key={line.ingredientId} className="adm-row">
              <td className="px-3 py-2.5 font-medium text-adm-text sm:px-4">{localized(line, "name", locale)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right text-base font-semibold tabular-nums text-adm-text sm:px-4">
                {formatQuantity(line.milli, locale)} {t.ingredients.units[line.unit]}
              </td>
              {costed && (
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums sm:px-4">
                  {line.amount === null ? <span className="text-adm-muted">{ts.noPrice}</span> : sum(line.amount)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      ))}
      {costed && list.totalAmount !== null && (
        <tfoot>
          <tr className="border-t border-adm-border">
            <th scope="row" colSpan={2} className="px-3 py-3 font-semibold sm:px-4">
              {ts.total}
              {list.unpriced ? <span className="adm-caption block font-normal">{ts.unpriced(list.unpriced)}</span> : null}
            </th>
            <td className="whitespace-nowrap px-3 py-3 text-right text-lg font-semibold tabular-nums text-adm-text sm:px-4">
              {sum(list.totalAmount)}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** What the list could not count, said before it: rations without a menu, and dishes without a usable tech card. */
export function ShoppingWarnings({ list, locale }: { list: ShoppingList; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const ts = t.shopping;
  return (
    <>
      {list.noMenuRations > 0 && <Notice tone="caution">{ts.noMenu(list.noMenuRations)}</Notice>}
      {list.uncounted.length > 0 && (
        <Notice tone="caution">
          <strong className="block font-semibold">{ts.uncountedTitle(list.uncounted.length)}</strong>
          {list.uncounted.map((dish) => (
            <UncountedLine key={dish.dishId} dish={dish} locale={locale} />
          ))}
        </Notice>
      )}
    </>
  );
}

function UncountedLine({ dish, locale }: { dish: UncountedDish; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const ts = t.shopping;
  const kg = new Intl.NumberFormat(htmlLang[locale], { maximumFractionDigits: 2 }).format(dish.grams / 1000);
  const name = localized(dish, "name", locale) || t.kitchen.unknownDish;
  return (
    <span className="mt-1 block font-normal">
      <Link href={`/tech-cards/${dish.dishId}`} className="font-semibold underline underline-offset-4">
        {name}
      </Link>{" "}
      · {ts.reasons[dish.state]} · {t.kitchen.portions(dish.portions)} · {t.kitchen.kg(kg)}
    </span>
  );
}
