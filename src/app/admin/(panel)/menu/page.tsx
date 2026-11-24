import { CalendarDays, UtensilsCrossed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { listDishes, listMenu, listPrograms } from "@/lib/admin/queries";
import { localized } from "@/lib/data/localized";
import { CYCLE_DAYS } from "@/lib/data/types";
import { EmptyState } from "../../kit/EmptyState";
import { Panel } from "../../kit/Panel";
import { DayEditor } from "./DayEditor";

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

  const [programs, dishes] = await Promise.all([listPrograms(supabase), listDishes(supabase)]);
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

  const menu = await listMenu(supabase, variant.id);
  const collator = new Intl.Collator(htmlLang[staff.locale]);
  const filledByDay = new Map<number, number>();
  for (const item of menu) filledByDay.set(item.cycle_day, (filledByDay.get(item.cycle_day) ?? 0) + 1);

  const href = (next: { variant?: string; day?: number }) =>
    `/menu?variant=${next.variant ?? variant.id}&day=${next.day ?? day}`;

  return (
    <div className="adm-page">
      <p className="adm-muted">{t.menu.lead(CYCLE_DAYS)}</p>

      {/* Calorie level */}
      <div className="flex flex-wrap gap-2">
        {variants.map((v) => (
          <Link
            key={v.id}
            href={href({ variant: v.id })}
            aria-current={v.id === variant.id ? "true" : undefined}
            className={`flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors ${
              v.id === variant.id
                ? "border-adm-accent bg-adm-accent text-adm-on-accent"
                : "border-adm-border bg-adm-surface text-adm-text hover:border-adm-accent"
            }`}
          >
            <span className="size-2.5 rounded-full" style={{ background: v.program.tag_color }} />
            {v.program.name} / <span className="tabular-nums">{v.kcal}</span>
          </Link>
        ))}
      </div>

      {/* Day grid: gold = selected, forest = complete, outline = partly filled */}
      <div className="grid grid-cols-10 gap-1.5 sm:max-w-xl">
        {Array.from({ length: CYCLE_DAYS }, (_, i) => i + 1).map((d) => {
          const filled = filledByDay.get(d) ?? 0;
          const complete = filled >= variant.meals_per_day;
          const tone =
            d === day
              ? "border-adm-highlight bg-adm-highlight text-adm-on-highlight font-semibold"
              : complete
                ? "border-adm-accent bg-adm-accent text-adm-on-accent"
                : filled > 0
                  ? "border-adm-accent bg-adm-surface text-adm-accent-ink"
                  : "border-adm-border bg-adm-surface text-adm-muted";
          return (
            <Link
              key={d}
              href={href({ day: d })}
              title={t.menu.dayTooltip(d, filled, variant.meals_per_day)}
              aria-current={d === day ? "true" : undefined}
              className={`flex aspect-square items-center justify-center rounded-lg border text-sm tabular-nums ${tone}`}
            >
              {d}
            </Link>
          );
        })}
      </div>

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
    </div>
  );
}
