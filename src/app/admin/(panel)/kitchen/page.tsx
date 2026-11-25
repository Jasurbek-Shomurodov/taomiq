import { CalendarX, ChefHat, ClipboardList, Hourglass, ListX, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang, type Locale } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import {
  buildProductionSheet,
  loadProductionDay,
  sheetDate,
  type SheetDishRow,
  type SheetProblem,
} from "@/lib/admin/kitchen";
import { formatDateTime, formatDay } from "@/lib/admin/orders";
import { loadShoppingList } from "@/lib/admin/tech-card-queries";
import type { ShoppingList } from "@/lib/admin/tech-cards";
import { DaySwitcher } from "../../kit/DaySwitcher";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { PrintButton, PrintTime } from "../../kit/PrintButton";
import { StatTile } from "../../kit/StatTile";
import { TopBarActions, TopBarTabs, TopBarTitle } from "../../shell/TopBarSlot";
import { ShoppingTable, ShoppingWarnings } from "./ShoppingTable";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).kitchen.title };
}

const DASH = "—";
const BASE_PATH = "/kitchen";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Kitchen → Production (docs/plans/kitchen-day-sheet.md, slice 1): what to cook on a day, by default tomorrow in
 * Tashkent. Every staff member sees it; it never shows a name, phone or address (the orders come through
 * public.kitchen_orders, which returns none). Each read fails on its own: a failed figure prints "—" and a notice
 * says what is missing, never a made-up 0.
 */
export default async function KitchenPage({ searchParams }: PageProps<"/admin/kitchen">) {
  const { supabase, staff } = await requireStaff();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const params = await searchParams;
  // Read the clock only after the session and the address (request-time reads), so it is the request's time.
  const now = new Date();
  const date = sheetDate(one(params.date), now);
  // The shopping list (slice 7) is read beside the sheet: quantities only (public.shopping_list), never money here.
  const [data, shopping] = await Promise.all([
    loadProductionDay(supabase, date.day),
    loadShoppingList(supabase, date.day, 1, false).catch((error: unknown) => {
      console.error("kitchen: shopping list failed", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);

  const sheet = buildProductionSheet(
    data.orders ?? [],
    data.menu ?? [],
    data.dishes ?? [],
    data.variants ?? [],
    locale,
  );
  // A part that failed to load says so in its own notice; it never turns into a "missing" problem.
  const problems = sheet.problems.filter((p) => (p.kind === "no-menu" ? data.menu !== null : data.dishes !== null));

  const dayText = formatDay(date.day, locale);
  const heading = t.kitchen.heading(dayText, data.cycleDay);
  const selfHref = `${BASE_PATH}?date=${date.day}`;
  const kgFormat = new Intl.NumberFormat(htmlLang[locale], { maximumFractionDigits: 2 });
  const kg = (grams: number) => kgFormat.format(grams / 1000);
  const ordersOk = data.orders !== null;
  const levelName = (label: string | null) => label ?? (data.variants === null ? DASH : t.kitchen.unknownLevel);
  const dishName = (name: string | null) => name ?? (data.dishes === null ? DASH : t.kitchen.unknownDish);

  const problemKey = (problem: SheetProblem): string =>
    problem.kind === "no-menu" ? `menu:${problem.variantId}` : `dish:${problem.dishId}`;

  const problemText = (problem: SheetProblem): string => {
    if (problem.kind === "no-menu") {
      return t.kitchen.noMenu(levelName(problem.label), data.cycleDay ?? 0, t.kitchen.rations(problem.rations));
    }
    const issues = [
      problem.missing && t.kitchen.dishMissing,
      problem.hidden && t.kitchen.dishHidden,
      problem.unverified && t.kitchen.dishUnverified,
    ].filter(Boolean);
    return t.kitchen.dishProblem(dishName(problem.name), issues.join(", "));
  };

  return (
    <div className="adm-page adm-sheet">
      <TopBarTitle>
        <span className="adm-truncate">{heading}</span>
      </TopBarTitle>
      <TopBarTabs>
        <DaySwitcher
          basePath={BASE_PATH}
          day={date.day}
          min={date.min}
          max={date.max}
          prev={date.prev}
          next={date.next}
          labels={{ group: t.kitchen.switcher, date: t.kitchen.date, prev: t.kitchen.prevDay, next: t.kitchen.nextDay }}
        />
      </TopBarTabs>
      <TopBarActions>
        <PrintButton label={t.kitchen.print} />
      </TopBarActions>

      {/* The top bar does not print: the sheet carries its own header line. */}
      <p className="adm-print-only adm-print-header">
        <strong>TAOMIQ</strong> · {t.kitchen.sheetName} · {heading} · {t.kitchen.printed}{" "}
        <PrintTime initial={formatDateTime(now.toISOString(), locale)} locale={locale} />
      </p>

      {!ordersOk && (
        <Notice tone="negative" retry={{ href: selfHref, label: t.common.retry }}>
          {t.kitchen.ordersFailed}
        </Notice>
      )}
      {data.menu === null && (
        <Notice tone="negative" retry={ordersOk ? { href: selfHref, label: t.common.retry } : undefined}>
          {t.kitchen.menuFailed}
        </Notice>
      )}
      {data.menu !== null && data.dishes === null && <Notice tone="caution">{t.kitchen.dishesFailed}</Notice>}
      {data.variants === null && <Notice tone="caution">{t.kitchen.catalogueFailed}</Notice>}

      {problems.length > 0 && (
        <Notice tone="caution">
          <strong className="block font-semibold">{t.kitchen.problems}</strong>
          {problems.map((problem) => (
            <span key={problemKey(problem)} className="mt-1 block font-normal">
              {problemText(problem)}
            </span>
          ))}
        </Notice>
      )}

      <div className="adm-sheet-tiles grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile
          label={t.kitchen.toCook}
          value={ordersOk ? sheet.firm : DASH}
          icon={ChefHat}
          footer={<span>{t.kitchen.toCookHint}</span>}
        />
        <StatTile
          label={t.kitchen.awaiting}
          value={ordersOk ? sheet.awaiting : DASH}
          icon={Hourglass}
          tone={sheet.awaiting > 0 ? "caution" : "accent"}
          footer={<span>{t.kitchen.awaitingHint}</span>}
        />
        <StatTile
          label={t.kitchen.withExclusions}
          value={ordersOk ? sheet.exclusions.length : DASH}
          icon={ListX}
          tone={sheet.exclusions.length > 0 ? "caution" : "accent"}
        />
      </div>

      {ordersOk && sheet.firm === 0 && (
        <Panel>
          <EmptyState icon={CalendarX} title={t.kitchen.empty(dayText)}>
            {sheet.awaiting > 0 ? t.kitchen.emptyAwaiting(sheet.awaiting) : undefined}
          </EmptyState>
        </Panel>
      )}

      {ordersOk && sheet.levels.length > 0 && (
        <Panel flush title={t.kitchen.levels} description={t.kitchen.levelsLead}>
          <table className="w-full text-left text-sm">
            <thead className="adm-table-head">
              <tr>
                <th className="px-3 py-2.5 font-medium sm:px-4">{t.kitchen.level}</th>
                <th className="px-3 py-2.5 text-right font-medium sm:px-4">{t.kitchen.cook}</th>
                <th className="px-3 py-2.5 text-right font-medium sm:px-4">{t.kitchen.awaitingColumn}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.levels.map((level) => (
                <tr key={level.variantId} className="adm-row">
                  <td className="px-3 py-3 font-semibold text-adm-text sm:px-4">{levelName(level.label)}</td>
                  <td className="px-3 py-3 text-right text-lg font-semibold tabular-nums text-adm-text sm:px-4">
                    {level.firm}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-adm-muted sm:px-4">{level.awaiting}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-adm-border">
                <th scope="row" className="px-3 py-3 font-semibold sm:px-4">
                  {t.kitchen.total}
                </th>
                <td className="px-3 py-3 text-right text-lg font-semibold tabular-nums text-adm-text sm:px-4">
                  {sheet.firm}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-adm-muted sm:px-4">{sheet.awaiting}</td>
              </tr>
            </tfoot>
          </table>
        </Panel>
      )}

      {ordersOk &&
        data.menu !== null &&
        sheet.slots.map((slot) => (
          <Panel
            key={slot.slot}
            flush
            title={t.menu.slots[slot.slot]}
            description={
              <span className="tabular-nums">
                {t.kitchen.portions(slot.portions)} · {t.kitchen.kg(kg(slot.grams))}
              </span>
            }
          >
            <table className="w-full text-left text-sm">
              <thead className="adm-table-head">
                <tr>
                  <th className="px-3 py-2.5 font-medium sm:px-4">{t.kitchen.dish}</th>
                  <th className="px-3 py-2.5 text-right font-medium sm:px-4">{t.kitchen.weight}</th>
                  <th className="px-3 py-2.5 text-right font-medium sm:px-4">{t.kitchen.portionsColumn}</th>
                  <th className="px-3 py-2.5 text-right font-medium sm:px-4">{t.kitchen.kgColumn}</th>
                </tr>
              </thead>
              {slot.dishes.map((dish) => (
                <DishRows
                  key={dish.dishId}
                  dish={dish}
                  name={dishName(dish.name)}
                  kg={kg}
                  unit={t.common.g}
                  total={t.kitchen.dishTotal(t.kitchen.portions(dish.portions), t.kitchen.kg(kg(dish.grams)))}
                />
              ))}
              <tfoot>
                <tr className="border-t border-adm-border">
                  <th scope="row" colSpan={2} className="px-3 py-3 font-semibold sm:px-4">
                    {t.kitchen.total}
                  </th>
                  <td className="px-3 py-3 text-right text-lg font-semibold tabular-nums text-adm-text sm:px-4">
                    {slot.portions}
                  </td>
                  <td className="px-3 py-3 text-right text-lg font-semibold tabular-nums text-adm-text sm:px-4">
                    {kg(slot.grams)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Panel>
        ))}

      {ordersOk && sheet.firm > 0 && (
        <Panel flush title={t.kitchen.exclusions} description={t.kitchen.exclusionsLead}>
          {sheet.exclusions.length === 0 ? (
            <p className="adm-muted px-5 py-4">{t.kitchen.noExclusions}</p>
          ) : (
            <ul>
              {sheet.exclusions.map((row) => (
                <li key={row.number} className="adm-row adm-sheet-line px-4 py-3 sm:px-5">
                  <span className="font-semibold tabular-nums text-adm-text">#{row.number}</span>
                  <span className="text-adm-muted"> · {levelName(row.label)} · </span>
                  <span className="whitespace-pre-line break-words text-adm-text">{row.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <ShoppingBlock list={shopping} day={date.day} selfHref={selfHref} locale={locale} />
    </div>
  );
}

/**
 * The day's shopping list under the sheet (not printed with it: its own print view is /kitchen/shopping, with a
 * three-day total). Quantities only.
 */
function ShoppingBlock({
  list,
  day,
  selfHref,
  locale,
}: {
  list: ShoppingList | null;
  day: string;
  selfHref: string;
  locale: Locale;
}) {
  const t = getAdminDictionary(locale);
  const ts = t.shopping;
  const actions = (
    <>
      <Link href={`/kitchen/shopping?date=${day}&days=3`} className="adm-btn adm-btn-outline adm-btn-sm">
        {ts.threeDays}
      </Link>
      <Link href={`/kitchen/shopping?date=${day}`} className="adm-btn adm-btn-outline adm-btn-sm">
        <Printer aria-hidden="true" />
        {ts.openPrint}
      </Link>
    </>
  );
  return (
    <section className="adm-no-print grid gap-3" aria-label={ts.title}>
      {list && <ShoppingWarnings list={list} locale={locale} />}
      <Panel flush title={ts.title} description={ts.blockLead} actions={actions}>
        {!list ? (
          <div className="p-4">
            <Notice tone="negative" retry={{ href: selfHref, label: t.common.retry }}>
              {ts.loadFailed}
            </Notice>
          </div>
        ) : list.rations === 0 ? (
          <p className="adm-muted px-5 py-4">{ts.blockEmpty}</p>
        ) : list.lines.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            action={
              <Link href="/tech-cards" className="adm-btn adm-btn-outline">
                {ts.toTechCards}
              </Link>
            }
          >
            {ts.noCards}
          </EmptyState>
        ) : (
          <ShoppingTable list={list} costed={false} locale={locale} />
        )}
      </Panel>
    </section>
  );
}

/** One dish of a slot: a row per portion weight, the name spanning them, and the dish total under the name. */
function DishRows({
  dish,
  name,
  kg,
  unit,
  total,
}: {
  dish: SheetDishRow;
  name: string;
  kg: (grams: number) => string;
  unit: string;
  total: string;
}) {
  return (
    <tbody className="adm-sheet-dish border-b border-adm-hairline">
      {dish.lines.map((line, i) => (
        <tr key={line.weight_g}>
          {i === 0 && (
            <th
              scope="rowgroup"
              rowSpan={dish.lines.length}
              className="px-3 py-3 align-top font-semibold text-adm-text sm:px-4"
            >
              {name}
              {dish.lines.length > 1 && (
                <span className="adm-caption mt-0.5 block font-normal tabular-nums">{total}</span>
              )}
            </th>
          )}
          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums sm:px-4">
            {line.weight_g} {unit}
          </td>
          <td className="px-3 py-3 text-right text-lg font-semibold tabular-nums text-adm-text sm:px-4">
            {line.portions}
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums sm:px-4">{kg(line.grams)}</td>
        </tr>
      ))}
    </tbody>
  );
}
