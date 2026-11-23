/**
 * Calorie and macro estimate for the public calculator.
 * Mifflin-St Jeor resting energy × activity factor, adjusted for the goal.
 * An estimate for choosing a ration, not a medical prescription.
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
