/**
 * The shared maths of the public calculator (/calculator, src/lib/body-goal.ts) and the program finder (/quiz):
 * input ranges, activity factors, one protein rule and macro split, BMI, water, and the program level that fits.
 * Calories come from one place for both pages, calculateBodyGoal() in src/lib/body-goal.ts (the quiz through
 * quizBodyGoal()). Estimates for choosing a ration, not a medical prescription.
 */

export type Sex = "female" | "male";
export type Activity = "low" | "light" | "moderate" | "high";
export type Goal = "lose" | "maintain" | "gain";

export const ACTIVITIES: readonly Activity[] = ["low", "light", "moderate", "high"];
export const GOALS: readonly Goal[] = ["lose", "maintain", "gain"];

/** Physical activity multipliers applied to resting energy (Harris-Benedict style levels). */
export const ACTIVITY_FACTOR: Record<Activity, number> = {
  low: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
};

/** Accepted input ranges (the formulas are meant for adults). */
export const RANGES = {
  age: { min: 18, max: 80 },
  height: { min: 140, max: 220 },
  weight: { min: 40, max: 200 },
} as const;
export type NumericField = keyof typeof RANGES;

/** Which program wins when two calorie levels are equally close to the norm. */
export const GOAL_PROGRAM: Record<Goal, string> = {
  lose: "light",
  maintain: "balance",
  gain: "protein",
};

/** A program and its calorie levels, as the calculator and the quiz get them from the catalogue. */
export type CalculatorProgram = {
  slug: string;
  name: string;
  tagColor: string;
  variants: { kcal: number; fromPrice: number }[];
};

/** Parse a typed number; null when empty or not a whole number in range. */
export function parseField(field: NumericField, raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  if (!raw.trim() || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const { min, max } = RANGES[field];
  return rounded >= min && rounded <= max ? rounded : null;
}

/* ---------------------------------------------------------------------------------------
   Protein, fat and carbs: one rule for the calculator and the quiz
   --------------------------------------------------------------------------------------- */

/**
 * Protein in g per kg of the reference weight (`referenceWeight()`): 1.6 g/kg is where muscle gains plateau
 * (Morton et al., Br J Sports Med 2018); 2.0 in a deficit keeps muscle (Helms et al., JISSN 2014, 1.8–2.2).
 */
export const PROTEIN_G_PER_KG_FOR_GOAL: Record<Goal, number> = { lose: 2.0, maintain: 1.6, gain: 1.6 };
/** Never more protein than this per kg, whatever the goal (the site states it on the calculator). */
export const PROTEIN_MAX_PER_KG = 2.0;
/** If carbs would fall under the RDA (CARBS_MIN_G), protein may drop to this, never lower. */
export const PROTEIN_MIN_G_PER_KG = 1.6;
/**
 * Fat: 0.8 g per kg of the reference weight, kept within 25–35 % of calories (35 % is the top of the adult
 * Acceptable Macronutrient Distribution Range, National Academies 2002/2005).
 */
export const FAT_G_PER_KG = 0.8;
export const FAT_MIN_SHARE = 0.25;
export const FAT_MAX_SHARE = 0.35;
/** Carbohydrate RDA for adults (National Academies DRI, 2002/2005): the brain's minimum glucose. */
export const CARBS_MIN_G = 130;
/** The reference weight is never above the weight at this BMI (an adjusted body weight). */
export const REFERENCE_MAX_BMI = 25;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * The weight the grams per kg apply to: the lower of today's and the goal weight, capped at the BMI 25 weight
 * for the height (an adjusted body weight). A heavier body or a far-off goal does not inflate protein and fat.
 */
export function referenceWeight(input: { height: number; weight: number; goalWeight: number }): number {
  const cap = REFERENCE_MAX_BMI * (input.height / 100) ** 2;
  return Math.min(input.weight, input.goalWeight, cap);
}

export type Macros = {
  /** Grams a day, whole. */
  protein: number;
  fat: number;
  carbs: number;
  /** Protein actually used, g per kg of the reference weight, one decimal. */
  proteinPerKg: number;
};

/**
 * Protein and fat per kg of the reference weight, fat within 25–35 % of calories, carbs the rest. Protein is never
 * above PROTEIN_MAX_PER_KG. If carbs would fall under their RDA, fat gives way first (down to 25 %), then protein
 * (down to PROTEIN_MIN_G_PER_KG); a very low calorie level can still leave carbs under 130 g. Whatever happens,
 * protein and fat never add up to more than the calories: fat drops to its 25 % floor, then protein, so carbs are
 * never negative and the three add up to the calories.
 */
export function splitMacros(input: { kcal: number; referenceWeight: number; proteinPerKg: number }): Macros {
  const { kcal, referenceWeight: refWeight } = input;
  const proteinPerKgTarget = Math.min(input.proteinPerKg, PROTEIN_MAX_PER_KG);
  const fatMin = (FAT_MIN_SHARE * kcal) / 9;
  const fatMax = (FAT_MAX_SHARE * kcal) / 9;
  let fatGrams = clamp(FAT_G_PER_KG * refWeight, fatMin, fatMax);
  let proteinGrams = proteinPerKgTarget * refWeight;
  const proteinFloor = Math.min(PROTEIN_MIN_G_PER_KG, proteinPerKgTarget) * refWeight;
  const carbGap = () => CARBS_MIN_G - (kcal - 4 * proteinGrams - 9 * fatGrams) / 4;
  if (carbGap() > 0) fatGrams = Math.max(fatMin, fatGrams - (carbGap() * 4) / 9);
  if (carbGap() > 0) proteinGrams = Math.max(proteinFloor, proteinGrams - carbGap());
  if (4 * proteinGrams + 9 * fatGrams > kcal) fatGrams = Math.min(fatGrams, fatMin);
  if (4 * proteinGrams + 9 * fatGrams > kcal) proteinGrams = Math.max(0, (kcal - 9 * fatGrams) / 4);
  const protein = Math.round(proteinGrams);
  const fat = Math.round(fatGrams);
  return {
    protein,
    fat,
    carbs: Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4)),
    proteinPerKg: Math.round((proteinGrams / refWeight) * 10) / 10,
  };
}

/* ---------------------------------------------------------------------------------------
   BMI and water. Standard, conservative estimates for adults; neither is a medical prescription.
   --------------------------------------------------------------------------------------- */

/** WHO adult BMI classes (kg/m²): below 18.5, 18.5–24.9, 25–29.9, 30 and above. */
export type BmiCategory = "under" | "normal" | "over" | "obese";
export const BMI_CATEGORIES: readonly BmiCategory[] = ["under", "normal", "over", "obese"];
export const BMI_NORMAL = { min: 18.5, max: 24.9 } as const;

export type BmiResult = {
  /** kg/m², one decimal. */
  bmi: number;
  category: BmiCategory;
  /** The weight range (kg, whole) that gives a BMI of 18.5–24.9 at this height. */
  normalMin: number;
  normalMax: number;
};

export function bmiCategory(bmi: number): BmiCategory {
  if (bmi < 18.5) return "under";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "over";
  return "obese";
}

export function bodyMassIndex(input: { height: number; weight: number }): BmiResult {
  const meters = input.height / 100;
  const bmi = Math.round((input.weight / meters ** 2) * 10) / 10;
  return {
    bmi,
    category: bmiCategory(bmi),
    normalMin: Math.ceil(BMI_NORMAL.min * meters ** 2),
    normalMax: Math.floor(BMI_NORMAL.max * meters ** 2),
  };
}

/** Daily fluid: 30–35 ml per kg of body weight, plus a little for training. */
export const WATER_ML_PER_KG = { min: 30, max: 35 } as const;
export const WATER_ACTIVITY_ML: Record<Activity, number> = { low: 0, light: 250, moderate: 500, high: 750 };
/**
 * The most the calculator ever advises, in litres a day: a heavy, very active body would otherwise read 6–7 l, more
 * than general advice should push anyone to drink. Above WATER_CAP_L.max the range shows as 3.5–4.0 l and the page
 * says to follow a doctor for more.
 */
export const WATER_CAP_L = { min: 3.5, max: 4 } as const;

export type WaterResult = {
  /** Litres, one decimal. */
  min: number;
  max: number;
  /** The per-kg range went above WATER_CAP_L.max and was held at the cap. */
  capped: boolean;
};

export function waterNeed(input: { weight: number; activity: Activity }): WaterResult {
  const extra = WATER_ACTIVITY_ML[input.activity];
  const min = Math.round((input.weight * WATER_ML_PER_KG.min + extra) / 100) / 10;
  const max = Math.round((input.weight * WATER_ML_PER_KG.max + extra) / 100) / 10;
  if (max <= WATER_CAP_L.max) return { min, max, capped: false };
  return { min: Math.min(min, WATER_CAP_L.min), max: WATER_CAP_L.max, capped: true };
}

/** A number with one decimal and the comma all three site languages write: 22.5 → "22,5", 3 → "3,0". */
export function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}

/* ---------------------------------------------------------------------------------------
   The program level that fits
   --------------------------------------------------------------------------------------- */

/**
 * The calorie level closest to the norm, across every program the catalogue currently has. Only when two levels
 * are equally close does the goal decide (its own program first, GOAL_PROGRAM), so "the closest level" on the
 * page is always true.
 */
export function recommend<P extends { slug: string; variants: { kcal: number }[] }>(
  programs: P[],
  kcal: number,
  goal: Goal,
): { program: P; variant: P["variants"][number] } | null {
  let best: { program: P; variant: P["variants"][number]; distance: number; preferred: boolean } | null = null;
  for (const program of programs) {
    for (const variant of program.variants) {
      const distance = Math.abs(variant.kcal - kcal);
      const preferred = program.slug === GOAL_PROGRAM[goal];
      if (!best || distance < best.distance || (distance === best.distance && preferred && !best.preferred)) {
        best = { program, variant, distance, preferred };
      }
    }
  }
  return best && { program: best.program, variant: best.variant };
}

/** A norm at least this many kcal above the largest ration gets a note instead of "the closest level". */
export const FAR_ABOVE_LARGEST_KCAL = 1000;

/**
 * The largest calorie level on offer, when the norm is FAR_ABOVE_LARGEST_KCAL or more above it; otherwise null.
 * One ration alone would leave such a visitor far short, so the page says so.
 */
export function largestLevelFarBelow(programs: { variants: { kcal: number }[] }[], kcal: number): number | null {
  const levels = programs.flatMap((p) => p.variants.map((v) => v.kcal));
  if (levels.length === 0) return null;
  const largest = Math.max(...levels);
  return kcal - largest >= FAR_ABOVE_LARGEST_KCAL ? largest : null;
}
