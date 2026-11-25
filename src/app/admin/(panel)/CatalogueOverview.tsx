import { CameraOff, ClipboardList, Eye, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { dishesHref, matchesDishStatus } from "@/lib/admin/dish-status";
import { listDishes, listPrograms, menuCounts } from "@/lib/admin/queries";
import { CYCLE_DAYS } from "@/lib/data/types";
import { EmptyState } from "../kit/EmptyState";
import { Notice } from "../kit/Notice";
import { Panel } from "../kit/Panel";
import { StatTile } from "../kit/StatTile";

const DASH = "—";

/** A read that fails on its own: logged, and null to the page, which prints "—" and a notice for it. */
async function settle<T>(what: string, read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    console.error(`overview: ${what} failed`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * What every staff member sees: the dish tiles (each opens the dishes list with the matching ?status= filter, so the
 * tile's number is the list's length) and the 30-day menu readiness per calorie level. The two fail independently.
 */
export async function CatalogueOverview({ locale }: { locale: Locale }) {
  const { supabase } = await requireStaff();
  const t = getAdminDictionary(locale);
  const [dishes, programs, counts] = await Promise.all([
    settle("dishes", listDishes(supabase)),
    settle("programs", listPrograms(supabase)),
    settle("menu counts", menuCounts(supabase)),
  ]);

  const count = (filter: Parameters<typeof matchesDishStatus>[1]) =>
    dishes ? dishes.filter((dish) => matchesDishStatus(dish, filter)).length : null;
  const visible = count("visible");
  const hidden = count("hidden");
  const noCard = count("no-card");
  const noPhoto = count("no-photo");
  // Archived dishes are not in the catalogue the tiles count (the dishes list leaves them out of "all" too).
  const all = count(null);
  const retry = { href: "/", label: t.common.retry };
  const variants = programs?.flatMap((program) => program.variants.map((variant) => ({ program, variant }))) ?? [];

  return (
    <>
      {!dishes && (
        <Notice tone="negative" retry={retry}>
          {t.home.dishesFailed}
        </Notice>
      )}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile label={t.home.dishes} value={all ?? DASH} icon={UtensilsCrossed} href={dishesHref()} />
        <StatTile
          label={t.home.visible}
          value={visible ?? DASH}
          icon={Eye}
          href={dishesHref("visible")}
          footer={hidden ? <span>{t.home.hiddenCount(hidden)}</span> : undefined}
        />
        <StatTile
          label={t.home.unverified}
          value={noCard ?? DASH}
          icon={ClipboardList}
          href={dishesHref("no-card")}
          tone={(noCard ?? 0) > 0 ? "caution" : "accent"}
        />
        <StatTile
          label={t.home.noPhoto}
          value={noPhoto ?? DASH}
          icon={CameraOff}
          href={dishesHref("no-photo")}
          tone={(noPhoto ?? 0) > 0 ? "caution" : "accent"}
        />
      </div>

      <Panel flush title={t.home.menuTitle} description={t.home.menuLead(CYCLE_DAYS)}>
        {!programs || !counts ? (
          <div className="p-5">
            <Notice tone="negative" retry={retry}>
              {t.home.menuFailed}
            </Notice>
          </div>
        ) : variants.length === 0 ? (
          <EmptyState icon={UtensilsCrossed}>{t.menu.noVariant}</EmptyState>
        ) : (
          variants.map(({ program, variant }) => {
            const done = counts.get(variant.id)?.days ?? 0;
            return (
              <Link
                key={variant.id}
                href={`/menu?variant=${variant.id}`}
                className="adm-row flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5"
              >
                <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: program.tag_color }} />
                <span className="min-w-[10rem] flex-1 font-semibold sm:max-w-[14rem]">
                  {program.name} / <span className="tabular-nums">{variant.kcal}</span>
                </span>
                <span
                  aria-hidden="true"
                  className="order-last h-2 min-w-full flex-1 overflow-hidden rounded-full bg-adm-surface-muted sm:order-none sm:min-w-0"
                >
                  <span
                    className="block h-full rounded-full bg-adm-accent"
                    style={{ width: `${Math.min(done / CYCLE_DAYS, 1) * 100}%` }}
                  />
                </span>
                <span className="w-16 text-right text-sm tabular-nums text-adm-muted">
                  {done} / {CYCLE_DAYS}
                </span>
              </Link>
            );
          })
        )}
      </Panel>
    </>
  );
}
