/**
 * Calorie and macro estimate for the public calculator.
 * Mifflin-St Jeor resting energy × activity factor, adjusted for the goal.
 * An estimate for choosing a ration, not a medical prescription.
 * Below it: the protein, BMI and water tools of the calculator suite.
 */

export type Sex = "female" | "male";
export type Activity = "low" | "light" | "moderate" | "high";
export type Goal = "lose" | "maintain" | "gain";

export const ACTIVITIES: readonly Activity[] = ["low", "light", "moderate", "high"];
export const GOALS: readonly Goal[] = ["lose", "maintain", "gain"];

const ACTIVITY_FACTOR: Record<Activity, number> = {
  low: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
};

/** Calorie change for the goal: a moderate deficit or surplus, nothing aggressive. */
const GOAL_FACTOR: Record<Goal, number> = {
  lose: 0.85,
  maintain: 1,
  gain: 1.1,
};

/** Share of calories from protein / fat / carbohydrates. */
const MACRO_SPLIT: Record<Goal, { protein: number; fat: number; carbs: number }> = {
  lose: { protein: 0.3, fat: 0.3, carbs: 0.4 },
  maintain: { protein: 0.25, fat: 0.3, carbs: 0.45 },
  gain: { protein: 0.25, fat: 0.25, carbs: 0.5 },
};

/** Never suggest less than this; matches the lowest program level (docs/03). */
export const MIN_KCAL = 1200;

/** Accepted input ranges (the formula is meant for adults). */
export const RANGES = {
  age: { min: 18, max: 80 },
  height: { min: 140, max: 220 },
  weight: { min: 40, max: 200 },
} as const;
export type NumericField = keyof typeof RANGES;

/** Which program fits each goal best when calorie levels are equally close. */
export const GOAL_PROGRAM: Record<Goal, string> = {
  lose: "light",
  maintain: "balance",
  gain: "protein",
};

/** Extra distance (kcal) given to levels outside the goal's program, so it wins close calls. */
const OTHER_PROGRAM_PENALTY = 200;

export type CalculatorInput = {
  sex: Sex;
  age: number;
  height: number;
  weight: number;
  activity: Activity;
  goal: Goal;
};

export type CalculatorResult = {
  /** Daily calories, rounded to 10. */
  kcal: number;
  /** True when the formula gave less than MIN_KCAL and the result was raised to it. */
  floored: boolean;
  protein: number;
  fat: number;
  carbs: number;
};

/** Parse a typed number; null when empty or not a whole number in range. */
export function parseField(field: NumericField, raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  if (!raw.trim() || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const { min, max } = RANGES[field];
  return rounded >= min && rounded <= max ? rounded : null;
}

export function calculate(input: CalculatorInput): CalculatorResult {
  const resting =
    10 * input.weight + 6.25 * input.height - 5 * input.age + (input.sex === "male" ? 5 : -161);
  const raw = resting * ACTIVITY_FACTOR[input.activity] * GOAL_FACTOR[input.goal];
  const floored = raw < MIN_KCAL;
  const kcal = Math.round(Math.max(raw, MIN_KCAL) / 10) * 10;

  const split = MACRO_SPLIT[input.goal];
  return {
    kcal,
    floored,
    protein: Math.round((kcal * split.protein) / 4),
    fat: Math.round((kcal * split.fat) / 9),
    carbs: Math.round((kcal * split.carbs) / 4),
  };
}

/* ---------------------------------------------------------------------------------------
   The small tools (/calculator/protein, /bmi, /water). Standard, conservative estimates for
   adults, stated as such on each page; none of them is a medical prescription.
   --------------------------------------------------------------------------------------- */

/** The tools' URL segments under /calculator, in tab order after the calorie calculator itself. */
export const CALCULATOR_TOOLS = ["protein", "bmi", "water"] as const;
export type CalculatorTool = (typeof CALCULATOR_TOOLS)[number];

/** Rounds to `step` (5 g, 0.1 l …). */
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/**
 * Protein per kg of body weight by activity: from the adult reference intake of 0.8 g/kg for people who
 * barely move, up to the 1.4–1.8 g/kg commonly cited for people who train most days.
 */
const PROTEIN_PER_KG: Record<Activity, readonly [min: number, max: number]> = {
  low: [0.8, 1.0],
  light: [1.0, 1.2],
  moderate: [1.2, 1.6],
  high: [1.4, 1.8],
};
/** Losing weight (keep muscle on fewer calories) and gaining muscle both add 0.2 g/kg; never above this. */
const PROTEIN_GOAL_EXTRA: Record<Goal, number> = { lose: 0.2, maintain: 0, gain: 0.2 };
export const PROTEIN_MAX_PER_KG = 2.0;
/** From this lower bound (g/kg) the need counts as high and the PROTEIN program is suggested. */
export const HIGH_PROTEIN_PER_KG = 1.4;

export type ProteinResult = {
  /** g/kg, one decimal. */
  minPerKg: number;
  maxPerKg: number;
  /** Grams per day, rounded to 5. */
  min: number;
  max: number;
  /** Catalogue slug of the program that fits best. */
  program: string;
};

export function proteinNeed(input: { weight: number; activity: Activity; goal: Goal }): ProteinResult {
  const [baseMin, baseMax] = PROTEIN_PER_KG[input.activity];
  const extra = PROTEIN_GOAL_EXTRA[input.goal];
  const minPerKg = Math.min(baseMin + extra, PROTEIN_MAX_PER_KG);
  const maxPerKg = Math.min(baseMax + extra, PROTEIN_MAX_PER_KG);
  return {
    minPerKg: Math.round(minPerKg * 10) / 10,
    maxPerKg: Math.round(maxPerKg * 10) / 10,
    min: roundTo(input.weight * minPerKg, 5),
    max: roundTo(input.weight * maxPerKg, 5),
    program: minPerKg >= HIGH_PROTEIN_PER_KG - 1e-9 ? "protein" : GOAL_PROGRAM[input.goal],
  };
}

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
/** One glass, for the "≈ N glasses" line. */
export const GLASS_ML = 250;

export type WaterResult = {
  /** Litres, one decimal. */
  min: number;
  max: number;
  /** Glasses of GLASS_ML, whole. */
  glassesMin: number;
  glassesMax: number;
};

export function waterNeed(input: { weight: number; activity: Activity }): WaterResult {
  const extra = WATER_ACTIVITY_ML[input.activity];
  const minMl = input.weight * WATER_ML_PER_KG.min + extra;
  const maxMl = input.weight * WATER_ML_PER_KG.max + extra;
  return {
    min: Math.round(minMl / 100) / 10,
    max: Math.round(maxMl / 100) / 10,
    glassesMin: Math.round(minMl / GLASS_ML),
    glassesMax: Math.round(maxMl / GLASS_ML),
  };
}

/** A number with one decimal and the comma all three site languages write: 22.5 → "22,5", 3 → "3,0". */
export function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}

/**
 * The program level closest to the target, preferring the goal's own program on close calls.
 * Works on whatever programs and levels the catalogue currently has.
 */
export function recommend<P extends { slug: string; variants: { kcal: number }[] }>(
  programs: P[],
  kcal: number,
  goal: Goal,
): { program: P; variant: P["variants"][number] } | null {
  let best: { program: P; variant: P["variants"][number]; score: number } | null = null;
  for (const program of programs) {
    for (const variant of program.variants) {
      const score =
        Math.abs(variant.kcal - kcal) + (program.slug === GOAL_PROGRAM[goal] ? 0 : OTHER_PROGRAM_PENALTY);
      if (!best || score < best.score) best = { program, variant, score };
    }
  }
  return best && { program: best.program, variant: best.variant };
}
