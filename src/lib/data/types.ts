export const SLOTS = ["breakfast", "snack1", "lunch", "snack2", "dinner"] as const;
export type Slot = (typeof SLOTS)[number];

export const CYCLE_DAYS = 30;

export type Variant = {
  id: string;
  program_id: string;
  kcal: number;
  meals_per_day: number;
  price_per_day: number;
  sort: number;
  active: boolean;
};

export type Program = {
  id: string;
  slug: string;
  name: string;
  tag_color: string;
  tagline_uz: string;
  tagline_ru: string;
  description_uz: string;
  description_ru: string;
  sort: number;
  active: boolean;
  variants: Variant[];
};

export type Duration = {
  days: number;
  markup_pct: number;
  is_trial: boolean;
};

export type Dish = {
  id: string;
  name_uz: string;
  name_ru: string;
  photo_url: string | null;
  default_weight_g: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
  ingredients_uz: string;
  ingredients_ru: string;
  allergens: string[];
  verified: boolean;
  active: boolean;
};

export type MenuItem = {
  id: string;
  variant_id: string;
  cycle_day: number;
  slot: Slot;
  dish_id: string;
  weight_g: number;
};

export type MenuEntry = MenuItem & { dish: Dish };

export type Nutrition = { kcal: number; protein: number; fat: number; carbs: number };

/** Nutrition of one portion, from per-100 g values and the portion weight. */
export function portionNutrition(dish: Dish, weightG: number): Nutrition {
  const k = weightG / 100;
  return {
    kcal: Math.round(Number(dish.kcal_100) * k),
    protein: Math.round(Number(dish.protein_100) * k),
    fat: Math.round(Number(dish.fat_100) * k),
    carbs: Math.round(Number(dish.carbs_100) * k),
  };
}

export function sumNutrition(entries: { dish: Dish; weight_g: number }[]): Nutrition {
  return entries.reduce<Nutrition>(
    (total, entry) => {
      const n = portionNutrition(entry.dish, entry.weight_g);
      return {
        kcal: total.kcal + n.kcal,
        protein: total.protein + n.protein,
        fat: total.fat + n.fat,
        carbs: total.carbs + n.carbs,
      };
    },
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

/** Price per day for a duration, rounded to the nearest 1,000 UZS. */
export function pricePerDay(basePrice: number, markupPct: number): number {
  return Math.round((basePrice * (1 + Number(markupPct) / 100)) / 1000) * 1000;
}

/** Which day of the 30-day cycle a calendar date falls on (1…30). */
export function cycleDayFor(date: Date, anchorIso: string): number {
  const anchor = new Date(`${anchorIso}T00:00:00+05:00`); // Tashkent time
  const days = Math.floor((date.getTime() - anchor.getTime()) / 86_400_000);
  return (((days % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS) + 1;
}
