import { Grid3x3 } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { requireStockAccess } from "@/lib/admin/auth";
import { formatEntryDay } from "@/lib/admin/finance/month";
import { purchasesHref } from "@/lib/admin/purchase-links";
import { SHEET_MAX_DAYS, daysOf, formatQuantity, priceDiff, unitCost, type GridRow } from "@/lib/admin/purchases";
import { daysBetween, type ReportPeriod } from "@/lib/admin/reports";
import { loadPurchaseGrid } from "@/lib/admin/stock-queries";
import { localized } from "@/lib/data/localized";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { PurchaseSheet, type SheetCell, type SheetRow } from "./PurchaseSheet";

/**
 * Sheet: ingredients × days of the period (up to 62 days). Each cell is what was bought of that ingredient that day;
 * tapping it shows the amount, the buyers and the unit cost against the usual price. Everything shown is worked out
 * here, so the browser gets text only.
 */
export async function SheetTab({ period, today, locale }: { period: ReportPeriod; today: string; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const tp = t.purchases;
  const ts = tp.sheet;

  if (daysBetween(period.from, period.to) > SHEET_MAX_DAYS) {
    return (
      <Notice tone="caution">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {ts.tooLong(SHEET_MAX_DAYS)}
          <Link
            href={purchasesHref({ tab: "sheet", period: { from: "", to: "", preset: "month" } })}
            className="font-semibold underline underline-offset-4"
          >
            {ts.thisMonth}
          </Link>
        </span>
      </Notice>
    );
  }

  const { supabase } = await requireStockAccess();
  let grid: GridRow[] | null = null;
  try {
    grid = await loadPurchaseGrid(supabase, period);
  } catch (error) {
    console.error("purchases sheet failed", error instanceof Error ? error.message : error);
  }
  if (!grid) {
    return (
      <Notice tone="negative" retry={{ href: purchasesHref({ tab: "sheet", period }), label: t.common.retry }}>
        {ts.loadFailed}
      </Notice>
    );
  }
  if (grid.length === 0) {
    return (
      <Panel>
        <EmptyState icon={Grid3x3}>{ts.empty}</EmptyState>
      </Panel>
    );
  }

  const sum = (value: number) => `${formatSum(value)} ${t.common.currency}`;
  const days = daysOf(period.from, period.to);
  const rows: SheetRow[] = grid.map((row) => {
    const unit = t.ingredients.units[row.unit];
    const name = localized(row, "name", locale);
    const cells: Record<string, SheetCell> = {};
    for (const cell of row.cells) {
      const cost = unitCost(cell.amount, cell.milli);
      const diff = priceDiff(cost, row.usualPrice);
      cells[cell.day] = {
        short: formatQuantity(cell.milli, locale),
        quantity: `${formatQuantity(cell.milli, locale)} ${unit}`,
        amount: sum(cell.amount),
        receipts: ts.receipts(cell.receipts),
        buyers: cell.buyers.length ? ts.buyers(cell.buyers.join(", ")) : ts.noBuyers,
        cost: cost === null ? null : t.ingredients.priceText(sum(cost), unit),
        usual: row.usualPrice === null ? null : tp.usual(t.ingredients.priceText(sum(row.usualPrice), unit)),
        diff: diff === null ? null : diff.pct > 0 ? tp.above(diff.pct) : diff.pct < 0 ? tp.below(-diff.pct) : tp.same,
        tone: diff === null ? "neutral" : diff.pct > 0 ? "caution" : diff.pct < 0 ? "positive" : "neutral",
      };
    }
    return {
      key: `${row.ingredientId}:${row.unit}`,
      name,
      unit,
      total: `${formatQuantity(row.milli, locale)} ${unit}`,
      totalAmount: sum(row.amount),
      cells,
    };
  });

  return (
    <>
      <p className="adm-caption">{ts.lead}</p>
      <PurchaseSheet
        rows={rows}
        days={days.map((day) => ({
          day,
          label: formatEntryDay(day, locale),
          short: String(Number(day.slice(8))),
          isToday: day === today,
        }))}
        locale={locale}
      />
    </>
  );
}
