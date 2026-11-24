import { CameraOff, ClipboardList, ShoppingBag, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { requireStaff } from "@/lib/admin/auth";
import { listDishes, listPrograms, menuCounts, newOrderCount } from "@/lib/admin/queries";
import { CYCLE_DAYS } from "@/lib/data/types";
import { Panel } from "../kit/Panel";
import { StatTile } from "../kit/StatTile";

export default async function AdminHome() {
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  const [programs, dishes, counts, newOrders] = await Promise.all([
    listPrograms(supabase),
    listDishes(supabase),
    menuCounts(supabase),
    // Orders hold personal data: only the owner sees them. A failed count never breaks the overview.
    staff.role === "owner"
      ? newOrderCount(supabase).catch((error: unknown) => {
          console.error("new order count failed", error instanceof Error ? error.message : error);
          return null;
        })
      : undefined,
  ]);

  const unverified = dishes.filter((d) => d.active && !d.verified).length;
  const noPhoto = dishes.filter((d) => d.active && !d.photo_url).length;

  return (
    <div className="adm-page">
      <p className="adm-muted">{t.home.hello(staff.name)}</p>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        {newOrders !== undefined && (
          <StatTile
            label={t.home.newOrders}
            value={newOrders ?? "—"}
            icon={ShoppingBag}
            href="/orders?status=new"
            tone={(newOrders ?? 0) > 0 ? "caution" : "accent"}
          />
        )}
        <StatTile label={t.home.dishes} value={dishes.length} icon={UtensilsCrossed} href="/dishes" />
        <StatTile
          label={t.home.unverified}
          value={unverified}
          icon={ClipboardList}
          href="/dishes"
          tone={unverified > 0 ? "caution" : "accent"}
        />
        <StatTile
          label={t.home.noPhoto}
          value={noPhoto}
          icon={CameraOff}
          href="/dishes"
          tone={noPhoto > 0 ? "caution" : "accent"}
        />
      </div>

      <Panel flush title={t.home.menuTitle} description={t.home.menuLead(CYCLE_DAYS)}>
        {programs.flatMap((program) =>
          program.variants.map((variant) => {
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
                <span className="order-last h-2 min-w-full flex-1 overflow-hidden rounded-full bg-adm-surface-muted sm:order-none sm:min-w-0">
                  <span className="block h-full rounded-full bg-adm-accent" style={{ width: `${(done / CYCLE_DAYS) * 100}%` }} />
                </span>
                <span className="w-16 text-right text-sm tabular-nums text-adm-muted">
                  {done} / {CYCLE_DAYS}
                </span>
              </Link>
            );
          }),
        )}
      </Panel>
    </div>
  );
}
