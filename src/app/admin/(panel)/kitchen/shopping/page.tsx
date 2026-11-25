import { CalendarX, ChefHat, ClipboardList, ShoppingBasket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { requireStaff } from "@/lib/admin/auth";
import { sheetDate } from "@/lib/admin/kitchen";
import { formatDateTime, formatDay } from "@/lib/admin/orders";
import { canHandleStock } from "@/lib/admin/roles";
import { addDays } from "@/lib/admin/stats";
import { loadShoppingList } from "@/lib/admin/tech-card-queries";
import type { ShoppingList } from "@/lib/admin/tech-cards";
import { DaySwitcher } from "../../../kit/DaySwitcher";
import { EmptyState } from "../../../kit/EmptyState";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { PrintButton, PrintTime } from "../../../kit/PrintButton";
import { Segmented } from "../../../kit/Segmented";
import { StatTile } from "../../../kit/StatTile";
import { TopBarActions, TopBarBack, TopBarTabs, TopBarTitle } from "../../../shell/TopBarSlot";
import { ShoppingTable, ShoppingWarnings } from "../ShoppingTable";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).shopping.title };
}

const BASE_PATH = "/kitchen/shopping";
/** The longer span: the chosen day and the two after it. */
const SPAN_DAYS = 3;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Kitchen → Shopping list (docs/plans/zarkebab-feature-port.md, slice 7), printable: what to buy for the firm rations
 * of a day (`?date=`, tomorrow by default, as the production sheet) or of that day and the next two (`&days=3`), from
 * the 30-day menu and the tech cards (public.shopping_list, migration 0023). Quantities only for everyone; owners and
 * managers may add the usual prices and amounts (`&cost=1`, public.shopping_list_costed), never shown to the kitchen.
 * Dishes without a usable tech card are named, never silently left out.
 */
export default async function ShoppingPage({ searchParams }: PageProps<"/admin/kitchen/shopping">) {
  const { supabase, staff } = await requireStaff();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const ts = t.shopping;
  const params = await searchParams;
  const now = new Date();
  const date = sheetDate(one(params.date), now);
  const days = one(params.days) === String(SPAN_DAYS) ? SPAN_DAYS : 1;
  const stock = canHandleStock(staff.role);
  const costed = stock && one(params.cost) === "1";

  const query = (next: { days?: number; cost?: boolean }) => {
    const d = next.days ?? days;
    const c = next.cost ?? costed;
    return `${d > 1 ? `&days=${d}` : ""}${c ? "&cost=1" : ""}`;
  };
  const selfHref = `${BASE_PATH}?date=${date.day}${query({})}`;

  let list: ShoppingList | null = null;
  try {
    list = await loadShoppingList(supabase, date.day, days, costed);
  } catch (error) {
    console.error("shopping list failed", error instanceof Error ? error.message : error);
  }

  const range =
    days > 1 ? ts.range(formatDay(date.day, locale), formatDay(addDays(date.day, days - 1), locale)) : formatDay(date.day, locale);
  const heading = `${ts.title} · ${range}`;

  return (
    <div className="adm-page adm-sheet">
      <TopBarBack href={`/kitchen?date=${date.day}`} label={ts.back} />
      <TopBarTitle>
        <span className="adm-truncate">{heading}</span>
      </TopBarTitle>
      <TopBarTabs>
        <DaySwitcher
          basePath={BASE_PATH}
          extraQuery={query({})}
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

      <p className="adm-print-only adm-print-header">
        <strong>TAOMIQ</strong> · {heading} · {t.kitchen.printed}{" "}
        <PrintTime initial={formatDateTime(now.toISOString(), locale)} locale={locale} />
      </p>

      <div className="adm-no-print flex flex-wrap items-center gap-3">
        <Segmented
          label={ts.spanLabel}
          value={String(days)}
          items={[
            { key: "1", label: ts.oneDay, href: `${BASE_PATH}?date=${date.day}${query({ days: 1 })}` },
            { key: String(SPAN_DAYS), label: ts.threeDays, href: `${BASE_PATH}?date=${date.day}${query({ days: SPAN_DAYS })}` },
          ]}
        />
        {stock && (
          <Segmented
            label={ts.costLabel}
            value={costed ? "cost" : "plain"}
            items={[
              { key: "plain", label: ts.quantitiesOnly, href: `${BASE_PATH}?date=${date.day}${query({ cost: false })}` },
              { key: "cost", label: ts.withAmounts, href: `${BASE_PATH}?date=${date.day}${query({ cost: true })}` },
            ]}
          />
        )}
      </div>
      <p className="adm-caption adm-no-print">{ts.lead}</p>

      {!list ? (
        <Notice tone="negative" retry={{ href: selfHref, label: t.common.retry }}>
          {ts.loadFailed}
        </Notice>
      ) : (
        <>
          <div className="adm-sheet-tiles grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
            <StatTile label={ts.rations} value={list.rations} icon={ChefHat} />
            <StatTile label={ts.ingredients} value={list.lines.length} icon={ShoppingBasket} />
            <StatTile
              label={ts.dishesCounted}
              value={ts.ofTotal(list.countedDishes, list.dishes)}
              icon={ClipboardList}
              tone={list.countedDishes < list.dishes ? "caution" : "accent"}
            />
          </div>
          <ShoppingWarnings list={list} locale={locale} />
          {list.rations === 0 ? (
            <Panel>
              <EmptyState icon={CalendarX}>{ts.noRations(range)}</EmptyState>
            </Panel>
          ) : list.lines.length === 0 ? (
            <Panel>
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
            </Panel>
          ) : (
            <Panel flush title={ts.listTitle} description={ts.roundedUp}>
              <ShoppingTable list={list} costed={costed} locale={locale} />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
