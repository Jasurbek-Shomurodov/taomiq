import Image from "next/image";
import type { CSSProperties } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { portionNutrition, sumNutrition, type MenuEntry } from "@/lib/data/types";
import { InViewGrow } from "./InViewGrow";
import { Monogram } from "./Logo";
import { DISH_BODY, DISH_CARD, DISH_IMAGE, DISH_LIST } from "./menu-styles";

/** One day's meals with weights, kcal and Б/Ж/У, plus the day total. */
export function MenuDay({
  entries,
  targetKcal,
  locale,
  t,
  eagerFirstImage = false,
}: {
  entries: MenuEntry[];
  targetKcal: number;
  locale: Locale;
  t: Dictionary;
  /** The first photo may be the largest thing on screen (menu page): load it at once. */
  eagerFirstImage?: boolean;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line bg-white/50 p-8 text-center text-muted">
        {t.menu.empty}
      </p>
    );
  }

  const total = sumNutrition(entries);
  // Share of the day's energy from each macro (4 / 9 / 4 kcal per gram).
  const energy = total.protein * 4 + total.fat * 9 + total.carbs * 4;
  const share = (kcal: number) => (energy > 0 ? kcal / energy : 0);
  const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

  const cells = [
    {
      label: t.menu.total,
      value: `${total.kcal} ${t.programs.kcal}`,
      hint: `${t.menu.target} ${targetKcal}`,
      ratio: targetKcal > 0 ? Math.min(total.kcal / targetKcal, 1) : 0,
    },
    ...(
      [
        [t.menu.proteinFull, total.protein, share(total.protein * 4)],
        [t.menu.fatFull, total.fat, share(total.fat * 9)],
        [t.menu.carbsFull, total.carbs, share(total.carbs * 4)],
      ] as const
    ).map(([label, grams, ratio]) => ({
      label,
      value: `${grams} ${t.menu.weight}`,
      hint: percent(ratio),
      ratio,
    })),
  ];

  return (
    <div>
      <ul className={`stagger ${DISH_LIST}`}>
        {entries.map((entry, index) => {
          const n = portionNutrition(entry.dish, entry.weight_g);
          const name = locale === "ru" ? entry.dish.name_ru : entry.dish.name_uz;
          const ingredients = locale === "ru" ? entry.dish.ingredients_ru : entry.dish.ingredients_uz;
          const eager = eagerFirstImage && index === 0;
          return (
            <li key={entry.id} className={DISH_CARD}>
              <div className={DISH_IMAGE}>
                {entry.dish.photo_url ? (
                  <Image
                    src={entry.dish.photo_url}
                    alt={name}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 112px"
                    loading={eager ? "eager" : undefined}
                    fetchPriority={eager ? "high" : undefined}
                    className="object-cover"
                  />
                ) : (
                  <DishPlaceholder />
                )}
                <span className="label absolute left-3 top-3 hidden rounded-full bg-forest px-3 py-1.5 text-ivory sm:inline-block">
                  {t.slots[entry.slot]}
                </span>
              </div>
              <div className={DISH_BODY}>
                <p className="label text-muted sm:hidden">{t.slots[entry.slot]}</p>
                <h3 className="mt-1 font-serif text-lg leading-snug text-forest sm:mt-0 sm:text-xl">{name}</h3>
                {ingredients && <p className="mt-1.5 text-sm text-muted">{ingredients}</p>}
                <p className="mt-auto pt-3 text-sm tabular-nums text-graphite sm:pt-4">
                  <span className="font-semibold">{n.kcal} {t.programs.kcal}</span>
                  <span className="text-muted">
                    {" · "}{entry.weight_g} {t.menu.weight}
                    {" · "}{t.menu.protein} {n.protein}
                    {" · "}{t.menu.fat} {n.fat}
                    {" · "}{t.menu.carbs} {n.carbs}
                  </span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <InViewGrow>
        <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-forest-soft text-ivory sm:grid-cols-4">
          {cells.map((cell) => (
            <div key={cell.label} className="bg-forest p-4">
              <dt className="label text-gold">{cell.label}</dt>
              <dd className="mt-1 font-serif text-2xl tabular-nums">{cell.value}</dd>
              <dd className="text-xs tabular-nums text-ivory/60">{cell.hint}</dd>
              <dd aria-hidden className="mt-3 h-1 overflow-hidden rounded-full bg-ivory/15">
                <span
                  className="grow-x block h-full rounded-full bg-gold"
                  style={{ "--bar": cell.ratio.toFixed(3) } as CSSProperties}
                />
              </dd>
            </div>
          ))}
        </dl>
      </InViewGrow>
    </div>
  );
}

/** No photo yet: a calm brand mark instead of a broken or empty frame. */
function DishPlaceholder() {
  return (
    <div
      className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_30%_25%,var(--color-ivory)_0%,var(--color-ivory-deep)_70%)]"
      aria-hidden
    >
      <Monogram size={80} onDark={false} className="size-12 opacity-50 sm:size-20" />
    </div>
  );
}
