/**
 * Pieces shared by the dish card (server, MenuDay) and the dish detail sheet (client, DishSheet).
 * Plain module without hooks, so both sides import it.
 */

export type NutritionLabels = {
  kcal: string;
  weight: string;
  protein: string;
  fat: string;
  carbs: string;
  proteinFull: string;
  fatFull: string;
  carbsFull: string;
};

/** `weight` is the portion's net weight; leave it out for a whole day's totals (the ration label). */
type Nutrition = { kcal: number; protein: number; fat: number; carbs: number; weight?: number };

/**
 * The brandbook's data line: `297 ккал · Б 11 · Ж 8 · У 46 · 270 г`, tracked sans, kcal in forest and the rest muted.
 * Screen readers get the full macro words; the line wraps between items, never inside one.
 */
export function DishDataLine({
  kcal,
  protein,
  fat,
  carbs,
  weight,
  labels,
  className = "",
}: Nutrition & { labels: NutritionLabels; className?: string }) {
  const macros = [
    [labels.protein, labels.proteinFull, protein],
    [labels.fat, labels.fatFull, fat],
    [labels.carbs, labels.carbsFull, carbs],
  ] as const;
  // The space after the dot is the line's only break opportunity: a narrow card wraps between items, never inside one.
  const dot = (
    <>
      <span aria-hidden className="pl-[0.35em] text-line">
        ·
      </span>{" "}
    </>
  );
  return (
    <p className={`text-[0.72rem] font-medium leading-relaxed tracking-[0.12em] text-muted tabular-nums ${className}`}>
      <span className="whitespace-nowrap font-semibold text-forest">
        {kcal} {labels.kcal}
      </span>
      {macros.map(([short, long, grams]) => (
        <span key={long}>
          {dot}
          <span className="whitespace-nowrap">
            <span aria-hidden>
              {short} {grams}
            </span>
            <span className="sr-only">
              {long} {grams} {labels.weight}
            </span>
          </span>
        </span>
      ))}
      {weight !== undefined && (
        <>
          {dot}
          <span className="whitespace-nowrap">
            {weight} {labels.weight}
          </span>
        </>
      )}
    </p>
  );
}

/** Data badges ("High protein", "Up to 350 kcal"): gold-tinted pills. */
export function DishBadges({ badges, className = "" }: { badges: readonly string[]; className?: string }) {
  if (badges.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1 ${className}`}>
      {badges.map((badge) => (
        <li
          key={badge}
          className="inline-flex h-5 items-center rounded-full bg-gold/25 px-2 text-[0.7rem] font-semibold leading-none text-forest"
        >
          {badge}
        </li>
      ))}
    </ul>
  );
}
