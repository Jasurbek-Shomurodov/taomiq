import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { loadRationCosts } from "@/lib/admin/tech-card-queries";
import { rationOverruns, type RationLevel } from "@/lib/admin/tech-cards";
import { Badge } from "../../kit/Badge";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { Skeleton } from "../../kit/Skeleton";
import { DASH, pct, resultClass, sumText } from "./figures";

/**
 * Finance → Month, owner only (docs/plans/zarkebab-feature-port.md, slice 7): what a day's ration costs per calorie
 * level against its price, from the 30-day menu, the tech cards and today's usual prices (public.ration_costs,
 * migration 0023). Not a figure of the month: it is the current menu at current prices, and the panel says so. A day
 * whose dishes are not all costed has no cost (never a partial one passed off as complete). Below: the cost-overrun
 * list, levels or days whose cost is above the price per day.
 */
export async function RationCostPanel({ locale }: { locale: Locale }) {
  const { supabase } = await requireOwner();
  const t = getAdminDictionary(locale);
  const tr = t.rationCost;

  let levels: RationLevel[] | null = null;
  try {
    levels = await loadRationCosts(supabase);
  } catch (error) {
    console.error("finance: ration costs failed", error instanceof Error ? error.message : error);
  }

  const toCards = (
    <Link href="/tech-cards" className="adm-btn adm-btn-outline adm-btn-sm">
      <ClipboardList aria-hidden="true" />
      {tr.toTechCards}
    </Link>
  );

  if (!levels) {
    return (
      <Panel title={tr.title} actions={toCards}>
        <Notice tone="negative" retry={{ href: "/finance", label: t.common.retry }}>
          {tr.loadFailed}
        </Notice>
      </Panel>
    );
  }

  const shown = levels.filter((level) => level.daysWithMenu > 0);
  if (shown.length === 0 || shown.every((level) => level.daysComplete === 0)) {
    return (
      <Panel title={tr.title} description={tr.lead} actions={toCards}>
        <EmptyState icon={ClipboardList}>{shown.length === 0 ? tr.noMenu : tr.noCosts}</EmptyState>
      </Panel>
    );
  }

  const overruns = rationOverruns(shown);
  const label = (level: RationLevel) => `${level.programName} ${level.kcal}`;

  return (
    <Panel title={tr.title} description={tr.lead} actions={toCards} flush className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="adm-table-head">
          <tr>
            <th className="px-4 py-2.5 font-medium">{tr.columns.level}</th>
            <th className="px-4 py-2.5 text-right font-medium">{tr.columns.price}</th>
            <th className="px-4 py-2.5 text-right font-medium">{tr.columns.cost}</th>
            <th className="px-4 py-2.5 text-right font-medium">{tr.columns.margin}</th>
            <th className="px-4 py-2.5 text-right font-medium">{tr.columns.days}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((level) => (
            <tr key={level.variantId} className="adm-row">
              <td className="px-4 py-3">
                <span className="font-semibold text-adm-text">{label(level)}</span>
                {!level.active && (
                  <Badge tone="neutral" className="ml-2">
                    {tr.inactive}
                  </Badge>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{sumText(level.pricePerDay, t)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-adm-text">
                {level.avgCost === null ? DASH : sumText(level.avgCost, t)}
              </td>
              <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${resultClass(level.avgMargin)}`}>
                {level.avgMargin === null ? DASH : sumText(level.avgMargin, t)}
                <span className="adm-caption block">{pct(level.avgMarginPct, locale)}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                {tr.daysOf(level.daysComplete, 30)}
                {(level.daysNotFull > 0 || level.daysNoCost > 0) && (
                  <span className="adm-caption block whitespace-normal">
                    {tr.notCounted(level.daysNotFull, level.daysNoCost)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-2 border-t border-adm-border px-4 py-4 sm:px-5">
        <h3 className="text-sm font-semibold text-adm-text">{tr.overrunsTitle}</h3>
        {overruns.levels.length === 0 && overruns.days.length === 0 ? (
          <p className="adm-caption">{tr.noOverruns}</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {overruns.levels.map((level) => (
              <li key={level.variantId} className="font-medium text-adm-negative">
                {tr.levelOverrun(label(level), sumText(level.avgCost ?? 0, t), sumText(level.pricePerDay, t))}
              </li>
            ))}
            {overruns.days.map(({ level, day }) => (
              <li key={`${level.variantId}:${day.cycleDay}`} className="text-adm-text">
                {tr.dayOverrun(label(level), day.cycleDay, sumText(day.cost ?? 0, t), sumText(level.pricePerDay, t))}
              </li>
            ))}
          </ul>
        )}
        <p className="adm-caption">{tr.note}</p>
      </div>
    </Panel>
  );
}

/** While the panel loads. */
export function RationCostSkeleton() {
  return (
    <div className="adm-panel grid gap-3" aria-hidden="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-64" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}
