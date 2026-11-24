import { CalendarDays, UtensilsCrossed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { listDishes, listMenu, listPrograms } from "@/lib/admin/queries";
import { localized } from "@/lib/data/localized";
import { CYCLE_DAYS, type Dish, type MenuItem, type Program } from "@/lib/data/types";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { DayEditor } from "./DayEditor";
import { MenuWorkspace, type PickerProps } from "./MenuWorkspace";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).menu.title };
}

export default async function MenuAdminPage({ searchParams }: PageProps<"/admin/menu">) {
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  const query = await searchParams;
  const pick = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  let programs: Program[];
  let dishes: Dish[];
  try {
    [programs, dishes] = await Promise.all([listPrograms(supabase), listDishes(supabase)]);
  } catch (error) {
    console.error("menu catalogue failed", error instanceof Error ? error.message : error);
    return <LoadFailed message={t.menu.loadFailed} retry={t.common.retry} href="/menu" />;
  }

  const variants = programs.flatMap((p) => p.variants.map((v) => ({ ...v, program: p })));
  const variant = variants.find((v) => v.id === pick("variant")) ?? variants[0];

  if (!variant) {
    return (
      <div className="adm-page">
        <Panel>
          <EmptyState icon={CalendarDays}>{t.menu.noVariant}</EmptyState>
        </Panel>
      </div>
    );
  }

  const requestedDay = Number(pick("day"));
  const day = Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= CYCLE_DAYS ? requestedDay : 1;
  const retryHref = `/menu?variant=${variant.id}&day=${day}`;

  let menu: MenuItem[];
  try {
    menu = await listMenu(supabase, variant.id);
  } catch (error) {
    console.error("menu items failed", error instanceof Error ? error.message : error);
    return <LoadFailed message={t.menu.loadFailed} retry={t.common.retry} href={retryHref} />;
  }

  const collator = new Intl.Collator(htmlLang[staff.locale]);
  const filledByDay = Array.from({ length: CYCLE_DAYS }, () => 0);
  for (const item of menu) {
    if (item.cycle_day >= 1 && item.cycle_day <= CYCLE_DAYS) filledByDay[item.cycle_day - 1] += 1;
  }

  const picker: PickerProps = {
    variants: variants.map((v) => ({
      id: v.id,
      label: `${v.program.name} / ${v.kcal}`,
      name: v.program.name,
      kcal: v.kcal,
      color: v.program.tag_color,
    })),
    variantId: variant.id,
    day,
    filledByDay,
    mealsPerDay: variant.meals_per_day,
    locale: staff.locale,
  };

  return (
    <div className="adm-page">
      <p className="adm-muted">{t.menu.lead(CYCLE_DAYS)}</p>

      {/* The picker lives in the workspace, outside the keyed editor, so a day switch keeps it (and focus). */}
      <MenuWorkspace picker={picker}>
        {dishes.length === 0 ? (
          <Panel>
            <EmptyState icon={UtensilsCrossed}>
              {t.menu.noDishes[0]}
              <Link href="/dishes/new" className="font-semibold text-adm-accent-ink underline underline-offset-4">
                {t.menu.noDishes[1]}
              </Link>
              {t.menu.noDishes[2]}
            </EmptyState>
          </Panel>
        ) : (
          <DayEditor
            // Remount when the selection changes so the form starts from the saved state.
            key={`${variant.id}-${day}`}
            variantId={variant.id}
            variantLabel={`${variant.program.name} / ${variant.kcal}`}
            targetKcal={variant.kcal}
            mealsPerDay={variant.meals_per_day}
            day={day}
            locale={staff.locale}
            dishes={dishes
              .filter((d) => d.active)
              .map((d) => ({
                id: d.id,
                name: localized(d, "name", staff.locale),
                weight: d.default_weight_g,
                kcal: Number(d.kcal_100),
                protein: Number(d.protein_100),
                fat: Number(d.fat_100),
                carbs: Number(d.carbs_100),
              }))
              .sort((a, b) => collator.compare(a.name, b.name))}
            saved={menu.filter((m) => m.cycle_day === day).map((m) => ({ slot: m.slot, dish_id: m.dish_id, weight_g: m.weight_g }))}
            otherVariants={variants
              .filter((v) => v.id !== variant.id)
              .map((v) => ({ id: v.id, label: `${v.program.name} / ${v.kcal}` }))}
          />
        )}
      </MenuWorkspace>
    </div>
  );
}

function LoadFailed({ message, retry, href }: { message: string; retry: string; href: string }) {
  return (
    <div className="adm-page">
      <Notice tone="negative" retry={{ href, label: retry }}>
        {message}
      </Notice>
    </div>
  );
}
