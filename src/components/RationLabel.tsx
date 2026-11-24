import { getDictionary } from "@/i18n";
import { formatSum, plural, type Locale } from "@/i18n/config";
import type { Nutrition, Program, Variant } from "@/lib/data/types";
import { DishDataLine, type NutritionLabels } from "./dish-parts";
import { Monogram } from "./Logo";

/**
 * The ration's packaging label (brandbook), drawn as the hero visual of the home and program pages: an ivory card
 * with a hairline gold border. Every value comes from the program and its calorie level, and the day's totals only
 * when the caller has a complete day of the menu; nothing is made up. Gold stays decoration here (border, rule, ring):
 * on ivory it is never text.
 *
 * `compact` is the smaller sticker that overlaps a cover photo's corner.
 */
export function RationLabel({
  program,
  variant,
  totals,
  locale,
  compact = false,
  className = "",
}: {
  program: Pick<Program, "name" | "tag_color">;
  variant: Pick<Variant, "kcal" | "meals_per_day" | "price_per_day">;
  /** The day's menu totals for this calorie level; the line is left out without them. */
  totals?: Nutrition;
  locale: Locale;
  compact?: boolean;
  className?: string;
}) {
  const t = getDictionary(locale);
  const labels: NutritionLabels = {
    kcal: t.programs.kcal,
    weight: t.menu.weight,
    protein: t.menu.protein,
    fat: t.menu.fat,
    carbs: t.menu.carbs,
    proteinFull: t.menu.proteinFull,
    fatFull: t.menu.fatFull,
    carbsFull: t.menu.carbsFull,
  };

  return (
    <figure
      aria-label={t.programs.rationLabel}
      className={`rounded-[1.5rem] border border-gold bg-ivory text-forest shadow-[0_24px_48px_-24px_rgb(0_0_0/0.5)] ${
        compact ? "p-5" : "p-6 sm:p-7"
      } ${className}`}
    >
      <div className="flex items-center justify-between gap-4">
        <Monogram size={compact ? 30 : 38} onDark={false} />
        {/* The coloured program tag: the one thing that differs between the programs' packaging. */}
        <span aria-hidden className="h-1.5 w-10 rounded-full" style={{ background: program.tag_color }} />
      </div>

      <p className={`label text-muted ${compact ? "mt-4" : "mt-6"}`}>
        TAOMIQ
      </p>
      <p
        className={`mt-1 break-words font-serif leading-none ${compact ? "text-3xl" : "text-4xl"}`}
      >
        {program.name}
      </p>
      <p className="label mt-3 text-graphite tabular-nums">
        {program.name} / {variant.kcal}
      </p>

      <hr aria-hidden className={`h-px border-0 bg-gold ${compact ? "my-4" : "my-5"}`} />

      <p className={`leading-snug text-graphite ${compact ? "text-xs" : "text-sm"}`}>
        <span className="whitespace-nowrap">
          {variant.meals_per_day} {plural(variant.meals_per_day, t.programs.mealForms)}
        </span>
        {/* The same separator as the data line below: the space after it is the line's only break opportunity. */}
        <span aria-hidden className="pl-[0.35em] text-line">
          ·
        </span>{" "}
        <span className="whitespace-nowrap">
          {t.hero.from} <span className="font-semibold tabular-nums text-forest">{formatSum(variant.price_per_day)}</span>{" "}
          {t.hero.perDay}
        </span>
      </p>

      {totals && (
        <div className="mt-2">
          <span className="sr-only">{t.menu.total}:</span>
          <DishDataLine {...totals} labels={labels} />
        </div>
      )}
    </figure>
  );
}
