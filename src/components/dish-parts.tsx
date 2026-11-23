import { Monogram } from "./Logo";

/**
 * Pieces shared by the dish card (server, MenuDay) and the dish detail sheet (client, DishSheet).
 * Plain module without hooks, so both sides import it.
 */

export type ChipLabels = {
  kcal: string;
  weight: string;
  protein: string;
  fat: string;
  carbs: string;
  proteinFull: string;
  fatFull: string;
  carbsFull: string;
};

const CHIP = "inline-flex h-6 items-center rounded-full px-2 text-xs leading-none tabular-nums";

/**
 * kcal (prominent), then protein / fat / carbs and the portion weight. Cards show the short letters (Б 25) with
 * the full words for screen readers; the sheet shows the full words.
 */
export function DishChips({
  kcal,
  protein,
  fat,
  carbs,
  weight,
  labels,
  full = false,
  className = "",
}: {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  weight: number;
  labels: ChipLabels;
  full?: boolean;
  className?: string;
}) {
  const macros = [
    [labels.protein, labels.proteinFull, protein],
    [labels.fat, labels.fatFull, fat],
    [labels.carbs, labels.carbsFull, carbs],
  ] as const;
  return (
    <ul className={`flex flex-wrap gap-1 ${className}`}>
      <li className={`${CHIP} bg-forest font-semibold text-ivory`}>
        {kcal} {labels.kcal}
      </li>
      {macros.map(([short, long, grams]) => (
        <li key={long} className={`${CHIP} bg-ivory-deep text-forest`}>
          {full ? (
            `${long} ${grams} ${labels.weight}`
          ) : (
            <>
              <span aria-hidden>
                {short} {grams}
              </span>
              <span className="sr-only">
                {long} {grams} {labels.weight}
              </span>
            </>
          )}
        </li>
      ))}
      <li className={`${CHIP} border border-line text-muted`}>
        {weight} {labels.weight}
      </li>
    </ul>
  );
}

/** Data badges ("High protein", "Up to 350 kcal"): gold-tinted, smaller than the chips. */
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

/** No photo yet: a calm brand mark instead of a broken or empty frame. */
export function DishPlaceholder({ className = "h-full" }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center bg-[radial-gradient(circle_at_30%_25%,var(--color-ivory)_0%,var(--color-ivory-deep)_70%)] ${className}`}
      aria-hidden
    >
      <Monogram size={80} onDark={false} className="size-12 opacity-50 sm:size-20" />
    </div>
  );
}
