import Image from "next/image";
import type { CSSProperties } from "react";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { ALLERGENS } from "@/lib/data/allergens";
import { LIGHT_MAX_KCAL, dishBadges } from "@/lib/data/badges";
import { localized } from "@/lib/data/localized";
import { portionNutrition, sumNutrition, type MenuEntry } from "@/lib/data/types";
import { DishButton, DishSheet, type DishDetail, type DishSheetLabels } from "./DishSheet";
import { InViewGrow } from "./InViewGrow";
import { DishBadges, DishChips, DishPlaceholder, type ChipLabels } from "./dish-parts";
import { DISH_BODY, DISH_CARD, DISH_IMAGE, DISH_LIST } from "./menu-styles";

/** The card opens its sheet: the button's ::after covers it (relative), it reacts to a press and shows the focus ring. */
const DISH_CARD_ACTION =
  "press lift relative cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold";

/**
 * One day's meals as cards (kcal, Б/Ж/У and weight chips, data badges), plus the day total. All dish text is in
 * the server-rendered card; a tap on a card opens its detail sheet (DishSheet).
 */
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

  const badgeText = {
    highProtein: t.menu.badges.highProtein,
    light: t.menu.badges.light.replace("{kcal}", String(LIGHT_MAX_KCAL)),
  };
  const details: DishDetail[] = entries.map((entry) => {
    const n = portionNutrition(entry.dish, entry.weight_g);
    return {
      name: localized(entry.dish, "name", locale),
      slot: t.slots[entry.slot],
      photoUrl: entry.dish.photo_url,
      ingredients: localized(entry.dish, "ingredients", locale),
      // An unknown code is shown as stored rather than hidden: an allergen must never disappear.
      allergens: entry.dish.allergens.map((code) => ALLERGENS.find((a) => a.code === code)?.[locale] ?? code),
      badges: dishBadges(n).map((badge) => badgeText[badge]),
      weight: entry.weight_g,
      ...n,
    };
  });
  const chipLabels: ChipLabels = {
    kcal: t.programs.kcal,
    weight: t.menu.weight,
    protein: t.menu.protein,
    fat: t.menu.fat,
    carbs: t.menu.carbs,
    proteinFull: t.menu.proteinFull,
    fatFull: t.menu.fatFull,
    carbsFull: t.menu.carbsFull,
  };
  const sheetLabels: DishSheetLabels = {
    ...chipLabels,
    close: t.nav.close,
    ingredients: t.menu.ingredients,
    allergens: t.menu.allergens,
  };

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
      <DishSheet dishes={details} labels={sheetLabels}>
        <ul className={`stagger ${DISH_LIST}`}>
          {entries.map((entry, index) => {
            const dish = details[index];
            const eager = eagerFirstImage && index === 0;
            return (
              <li key={entry.id} className={`${DISH_CARD} ${DISH_CARD_ACTION}`}>
                <div className={`zoom ${DISH_IMAGE}`}>
                  {dish.photoUrl ? (
                    <Image
                      src={dish.photoUrl}
                      alt={dish.name}
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
                    {dish.slot}
                  </span>
                </div>
                <div className={DISH_BODY}>
                  {/* Phones: the slot, then the badges, on one line. From sm the slot sits on the photo. */}
                  <div
                    className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${dish.badges.length > 0 ? "sm:mb-2" : "sm:hidden"}`}
                  >
                    <p className="label text-muted sm:hidden">{dish.slot}</p>
                    <DishBadges badges={dish.badges} />
                  </div>
                  <h3 className="mt-1 font-serif text-lg leading-snug text-forest sm:mt-0 sm:text-xl">
                    <DishButton index={index}>{dish.name}</DishButton>
                  </h3>
                  {dish.ingredients && <p className="mt-1.5 line-clamp-2 text-sm text-muted">{dish.ingredients}</p>}
                  <DishChips
                    kcal={dish.kcal}
                    protein={dish.protein}
                    fat={dish.fat}
                    carbs={dish.carbs}
                    weight={dish.weight}
                    labels={chipLabels}
                    className="mt-auto pt-3 sm:pt-4"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </DishSheet>

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
