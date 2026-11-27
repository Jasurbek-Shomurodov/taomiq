/**
 * The calculator (/calculator): the visitor sets sex, age, height, weight and how muscular they are now, and
 * the weight and muscularity they want, and gets calories, macros, water, BMI, fibre, a calm pace and the adult
 * reference intakes of key vitamins and minerals. Pure functions, no UI; plans in
 * docs/plans/body-goal-calculator.md (§0 replaces the body-type pictures with one figure per side that
 * morphs with the sliders, src/components/BodyFigure.tsx) and docs/plans/site-ux-navigation-pass.md (slice 4:
 * the one calculator, prefilled).
 *
 * Every number here is an estimate for healthy adults (18–80) choosing a ration, not a medical or
 * diet prescription.
 */

import {
  ACTIVITY_FACTOR,
  BMI_NORMAL,
  PROTEIN_G_PER_KG_FOR_GOAL,
  PROTEIN_MAX_PER_KG,
  RANGES,
  bodyMassIndex,
  referenceWeight,
  splitMacros,
  waterNeed,
  type Activity,
  type BmiResult,
  type Goal,
  type Sex,
  type WaterResult,
} from "./calculator";

/* ---------------------------------------------------------------------------------------
   Body composition: Deurenberg estimate, corrected for muscularity (§0)
   --------------------------------------------------------------------------------------- */

/** How muscular the visitor is (now, or wants to be), in four steps. */
export type Muscularity = "low" | "average" | "athletic" | "muscular";
export const MUSCULARITY_LEVELS: readonly Muscularity[] = ["low", "average", "athletic", "muscular"];

/**
 * Points of body fat added to the Deurenberg estimate per muscularity step. BMI cannot tell muscle from fat,
 * so a muscular body of the same BMI carries less fat than the formula says, a body with little muscle more.
 */
export const MUSCULARITY_BODY_FAT_OFFSET: Record<Muscularity, number> = {
  low: 2,
  average: 0,
  athletic: -4,
  muscular: -7,
};

/** Absolute guard on the body fat used (%), so the lean-mass maths never breaks at the extremes. */
export const BODY_FAT_LIMITS = { min: 5, max: 60 } as const;

/** The name of a body's shape, lean → heavy, from its body fat (for the figure's caption and the copy). */
export type BodyShape = "lean" | "fit" | "average" | "soft" | "heavy";
export const BODY_SHAPES: readonly BodyShape[] = ["lean", "fit", "average", "soft", "heavy"];

/** Body fat in % of body weight that a shape name stands for. */
export type BodyFatBand = {
  min: number;
  /** null for the open-ended top band ("32 % and more"). */
  max: number | null;
};

/**
 * Body-fat bands per shape name, as on the common body-type charts. Only names the shape: the maths uses
 * the estimate itself. Anything under a band's min belongs to the band below; under the lowest, "lean".
 */
export const BODY_FAT_BANDS: Record<Sex, Record<BodyShape, BodyFatBand>> = {
  male: {
    lean: { min: 8, max: 12 },
    fit: { min: 13, max: 17 },
    average: { min: 18, max: 24 },
    soft: { min: 25, max: 31 },
    heavy: { min: 32, max: null },
  },
  female: {
    lean: { min: 15, max: 19 },
    fit: { min: 20, max: 24 },
    average: { min: 25, max: 31 },
    soft: { min: 32, max: 38 },
    heavy: { min: 39, max: null },
  },
};

/**
 * What the calculator opens with, so a result shows on first paint (an example the page labels as such; every
 * value can be changed). The goal weight starts at `suggestGoalWeight()` for this height and weight.
 */
export const CALCULATOR_DEFAULTS = {
  sex: "female",
  age: 30,
  height: 165,
  weight: 64, // BMI 23.5: the example reads as a normal weight
  muscularity: "average",
  activity: "light",
} as const satisfies {
  sex: Sex;
  age: number;
  height: number;
  weight: number;
  muscularity: Muscularity;
  activity: Activity;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** BMI in kg/m², unrounded. */
function bmiOf(height: number, weight: number): number {
  return weight / (height / 100) ** 2;
}

/**
 * Body fat (%) from BMI, age and sex: Deurenberg, Weststrate & Seidell 1991 (Br J Nutr 65:105–114),
 * `1.2 × BMI + 0.23 × age − 10.8 × (male ? 1 : 0) − 5.4`.
 */
export function deurenbergBodyFat(input: { sex: Sex; age: number; height: number; weight: number }): number {
  const bmi = bmiOf(input.height, input.weight);
  return 1.2 * bmi + 0.23 * input.age - 10.8 * (input.sex === "male" ? 1 : 0) - 5.4;
}

/**
 * The body fat (%) the calculator works with: the Deurenberg estimate plus the muscularity offset, held
 * within BODY_FAT_LIMITS. Unrounded. A muscular 95 kg visitor is not treated as obese, and the same
 * function gives the goal's body fat from the goal weight and goal muscularity.
 */
export function bodyFatFor(input: {
  sex: Sex;
  age: number;
  height: number;
  weight: number;
  muscularity: Muscularity;
}): number {
  const estimate = deurenbergBodyFat(input) + MUSCULARITY_BODY_FAT_OFFSET[input.muscularity];
  return clamp(estimate, BODY_FAT_LIMITS.min, BODY_FAT_LIMITS.max);
}

/** The shape name for a body fat (%). */
export function bodyShape(sex: Sex, bodyFat: number): BodyShape {
  const bands = BODY_FAT_BANDS[sex];
  for (let i = BODY_SHAPES.length - 1; i > 0; i--) {
    const shape = BODY_SHAPES[i];
    if (bodyFat >= bands[shape].min) return shape;
  }
  return "lean";
}

/** How a body looks, for the figure's caption: the shape name, or athletic / muscular when the muscle shows. */
export type BodyLook = BodyShape | "athletic" | "muscular";

/**
 * The caption for a body: a muscular body reads as "muscular" up to average body fat, an athletic one as
 * "athletic" while lean or fit, and a low-muscle one in the fit band as "lean" (slim, not toned); otherwise
 * (and for any body in the soft or heavy band) the shape name.
 */
export function bodyLook(sex: Sex, bodyFat: number, muscularity: Muscularity): BodyLook {
  const shape = bodyShape(sex, bodyFat);
  if (muscularity === "muscular" && (shape === "lean" || shape === "fit" || shape === "average")) return "muscular";
  if (muscularity === "athletic" && (shape === "lean" || shape === "fit")) return "athletic";
  if (muscularity === "low" && shape === "fit") return "lean";
  return shape;
}

/* ---------------------------------------------------------------------------------------
   Goal weight: the slider's lower stop and its starting point
   --------------------------------------------------------------------------------------- */

/** The lowest goal weight (whole kg) offered: BMI 18.5 at this height (WHO), never under the input range. */
export function minGoalWeight(height: number): number {
  return Math.max(RANGES.weight.min, Math.ceil(BMI_NORMAL.min * (height / 100) ** 2));
}

/** BMI whose weight is the goal slider's upper stop (unless today's weight is higher). */
export const GOAL_MAX_BMI = 30;

/**
 * The highest goal weight (whole kg) offered: the BMI 30 weight at this height, or today's weight if that is
 * higher (a goal to keep or lose from there), never over the input range.
 */
export function maxGoalWeight(height: number, weight: number): number {
  const bmiTop = Math.floor(GOAL_MAX_BMI * (height / 100) ** 2);
  return Math.min(RANGES.weight.max, Math.max(Math.round(weight), bmiTop, minGoalWeight(height)));
}

/** A goal weight kept inside [minGoalWeight, maxGoalWeight]. */
export function clampGoalWeight(goalWeight: number, height: number, weight: number): number {
  return clamp(goalWeight, minGoalWeight(height), maxGoalWeight(height, weight));
}

/**
 * A first loss step for the goal slider's starting point: 10 % of today's weight, the initial goal in the
 * NIH obesity guidelines (1998), never past the top of the normal BMI range.
 */
export const FIRST_STEP_LOSS_SHARE = 0.1;

/**
 * Where the goal-weight slider starts, before the visitor moves it (whole kg): above a normal BMI, 10 %
 * less but not under the BMI 24.9 weight; under BMI 18.5, the BMI 18.5 weight; otherwise today's weight.
 * Always inside `clampGoalWeight()`.
 */
export function suggestGoalWeight(input: { height: number; weight: number }): number {
  const { height, weight } = input;
  const normalTop = Math.floor(BMI_NORMAL.max * (height / 100) ** 2);
  let goal = Math.round(weight);
  if (weight > normalTop) goal = Math.max(Math.round(weight * (1 - FIRST_STEP_LOSS_SHARE)), normalTop);
  return clampGoalWeight(goal, height, weight);
}

/* ---------------------------------------------------------------------------------------
   §3.3 Energy
   --------------------------------------------------------------------------------------- */

/**
 * lose: goal weight more than 1 kg under today's · gain: more than 1 kg over · tone: about the same
 * weight but more muscular · keep: about the same weight and muscularity (or less).
 */
export type Direction = "lose" | "tone" | "keep" | "gain";
export const DIRECTIONS: readonly Direction[] = ["lose", "tone", "keep", "gain"];

/** Goal weight within ± this many kg of today's counts as "the same weight". */
export const SAME_WEIGHT_KG = 1;
/** Energy in one kg of body weight change (the common 7,700 kcal/kg rule; Wishnofsky 1958). */
export const KCAL_PER_KG = 7700;
/** Losing: aim for 0.5 % of body weight a week… */
export const LOSS_RATE_PER_WEEK = 0.005;
/** …but never a deficit above 25 % of daily energy. */
export const MAX_DEFICIT_SHARE = 0.25;
/** Toning (same weight, more muscular): a small 10 % deficit. */
export const TONE_DEFICIT_SHARE = 0.1;
/** Gaining: +10 %, or +15 % for a "muscular" goal from a lean or fit body (≈ 0.25–0.5 % a week). */
export const GAIN_SURPLUS_SHARE = 0.1;
export const MUSCULAR_GAIN_SURPLUS_SHARE = 0.15;
/** Daily calorie floors (as in leading apps; docs/plans/calorie-scanner.md §2.2). */
export const KCAL_FLOOR: Record<Sex, number> = { female: 1200, male: 1500 };
/** The weeks-to-goal line appears only for a change of at least this many kg… */
export const MIN_TIMELINE_KG = 2;
/** …at a pace of at least this many kg a week (a floor can leave almost no deficit)… */
export const MIN_TIMELINE_PACE_KG = 0.1;
/** …as a range of ± 20 %. */
export const TIMELINE_SPREAD = 0.2;
/**
 * A loss always gets the timeline line; a gain only up to a goal BMI of 25, or 27 for an athletic or muscular
 * goal (muscle raises BMI), so the page never puts a date on gaining towards overweight.
 */
export const TIMELINE_GAIN_MAX_BMI = 25;
export const TIMELINE_GAIN_MAX_BMI_TRAINED = 27;
const WEEKS_PER_MONTH = 52 / 12;

/** Resting energy, Mifflin-St Jeor 1990: `10 × kg + 6.25 × cm − 5 × age + (male ? 5 : −161)`. */
export function mifflinStJeor(input: { sex: Sex; age: number; height: number; weight: number }): number {
  return 10 * input.weight + 6.25 * input.height - 5 * input.age + (input.sex === "male" ? 5 : -161);
}

/** Resting energy from lean body mass, Katch-McArdle: `370 + 21.6 × LBM`. */
export function katchMcArdle(leanMass: number): number {
  return 370 + 21.6 * leanMass;
}

const muscularityRank = (level: Muscularity) => MUSCULARITY_LEVELS.indexOf(level);

/** Direction from goal weight vs today's and the two muscularity levels. */
export function goalDirection(input: {
  weight: number;
  goalWeight: number;
  muscularity: Muscularity;
  goalMuscularity: Muscularity;
}): Direction {
  const delta = input.goalWeight - input.weight;
  if (delta < -SAME_WEIGHT_KG) return "lose";
  if (delta > SAME_WEIGHT_KG) return "gain";
  return muscularityRank(input.goalMuscularity) > muscularityRank(input.muscularity) ? "tone" : "keep";
}

/**
 * The calculator-suite goal for a direction, for the existing `recommend()` program pick
 * (lose → LIGHT, keep → BALANCE, gain → PROTEIN). Toning is a small deficit, so it maps to "lose".
 */
export const DIRECTION_GOAL: Record<Direction, Goal> = {
  lose: "lose",
  tone: "lose",
  keep: "maintain",
  gain: "gain",
};

/* ---------------------------------------------------------------------------------------
   §3.4 Macros and fibre
   --------------------------------------------------------------------------------------- */

/**
 * Protein per kg of the reference weight (`referenceWeight()` in src/lib/calculator.ts), by direction: the one
 * rule the quiz uses too (`PROTEIN_G_PER_KG_FOR_GOAL`): 2.0 g/kg to lose or tone, 1.6 to keep or gain. A
 * "muscular" goal adds 0.2, never above PROTEIN_MAX_PER_KG (2.0). Fat and carbs: `splitMacros()`.
 */
export const PROTEIN_G_PER_KG: Record<Direction, number> = {
  lose: PROTEIN_G_PER_KG_FOR_GOAL[DIRECTION_GOAL.lose],
  tone: PROTEIN_G_PER_KG_FOR_GOAL[DIRECTION_GOAL.tone],
  keep: PROTEIN_G_PER_KG_FOR_GOAL[DIRECTION_GOAL.keep],
  gain: PROTEIN_G_PER_KG_FOR_GOAL[DIRECTION_GOAL.gain],
};
export const MUSCULAR_PROTEIN_EXTRA = 0.2;

/** Fibre Adequate Intake: 14 g per 1,000 kcal (National Academies DRI, 2002/2005). */
export const FIBRE_G_PER_1000_KCAL = 14;

/* ---------------------------------------------------------------------------------------
   §3.5 Vitamins and minerals: US/Canada Dietary Reference Intakes (National Academies; the source of
   the NIH Office of Dietary Supplements fact sheets). Values depend on sex and age only, never on the
   goal: no "personalised" vitamin numbers and no supplement advice.
   --------------------------------------------------------------------------------------- */

/**
 * DRI life-stage bands for adults. The calculator accepts 18–80; an 18-year-old is in the DRI's
 * 14–18 band ("18"), everyone else in 19–30, 31–50, 51–70 or 71+ (the DRI's "> 70").
 */
export type AgeBand = "18" | "19-30" | "31-50" | "51-70" | "71+";
export const AGE_BANDS: readonly AgeBand[] = ["18", "19-30", "31-50", "51-70", "71+"];

export function ageBand(age: number): AgeBand {
  if (age <= 18) return "18";
  if (age <= 30) return "19-30";
  if (age <= 50) return "31-50";
  if (age <= 70) return "51-70";
  return "71+";
}

/**
 * rda: Recommended Dietary Allowance (meets the need of 97–98 % of healthy people) ·
 * ai: Adequate Intake (used where an RDA cannot be set) ·
 * limit: an amount to stay **under**. For sodium this is the 2019 Chronic Disease Risk Reduction
 * intake (CDRR), not a Tolerable Upper Intake Level: since 2019 sodium has no UL.
 */
export type DriKind = "rda" | "ai" | "limit";
/** Plain units; the page localises them (мг / mg, мкг / mkg). */
export type NutrientUnit = "mg" | "mcg";

export type NutrientKey =
  | "vitaminA"
  | "vitaminC"
  | "vitaminD"
  | "vitaminE"
  | "vitaminK"
  | "vitaminB12"
  | "folate"
  | "calcium"
  | "iron"
  | "magnesium"
  | "zinc"
  | "potassium"
  | "sodium"
  | "iodine";

/** Display order. */
export const NUTRIENTS: readonly NutrientKey[] = [
  "vitaminA",
  "vitaminC",
  "vitaminD",
  "vitaminE",
  "vitaminK",
  "vitaminB12",
  "folate",
  "calcium",
  "iron",
  "magnesium",
  "zinc",
  "potassium",
  "sodium",
  "iodine",
];

export type NutrientReference = {
  unit: NutrientUnit;
  kind: DriKind;
  /** Per day, by sex and DRI age band. */
  values: Record<Sex, Record<AgeBand, number>>;
};

/** One row of values in AGE_BANDS order: 18, 19–30, 31–50, 51–70, 71+. */
type BandRow = readonly [number, number, number, number, number];
function byAge(row: BandRow): Record<AgeBand, number> {
  return { "18": row[0], "19-30": row[1], "31-50": row[2], "51-70": row[3], "71+": row[4] };
}
function bySex(male: BandRow, female: BandRow = male): Record<Sex, Record<AgeBand, number>> {
  return { male: byAge(male), female: byAge(female) };
}

/**
 * Per-day reference intakes for non-pregnant, non-lactating adults. Sources: National Academies DRI
 * reports for calcium and vitamin D (2011); vitamins A and K, iron, zinc, iodine (2001); vitamin C
 * and E (2000); B12 and folate (1998); magnesium (1997); sodium and potassium (2019).
 * Vitamin A is µg RAE, vitamin E mg α-tocopherol, folate µg DFE.
 */
export const DRI: Record<NutrientKey, NutrientReference> = {
  //                                         18    19–30  31–50  51–70  71+
  vitaminA: { unit: "mcg", kind: "rda", values: bySex([900, 900, 900, 900, 900], [700, 700, 700, 700, 700]) },
  vitaminC: { unit: "mg", kind: "rda", values: bySex([75, 90, 90, 90, 90], [65, 75, 75, 75, 75]) },
  vitaminD: { unit: "mcg", kind: "rda", values: bySex([15, 15, 15, 15, 20]) },
  vitaminE: { unit: "mg", kind: "rda", values: bySex([15, 15, 15, 15, 15]) },
  vitaminK: { unit: "mcg", kind: "ai", values: bySex([75, 120, 120, 120, 120], [75, 90, 90, 90, 90]) },
  vitaminB12: { unit: "mcg", kind: "rda", values: bySex([2.4, 2.4, 2.4, 2.4, 2.4]) },
  folate: { unit: "mcg", kind: "rda", values: bySex([400, 400, 400, 400, 400]) },
  calcium: { unit: "mg", kind: "rda", values: bySex([1300, 1000, 1000, 1000, 1200], [1300, 1000, 1000, 1200, 1200]) },
  iron: { unit: "mg", kind: "rda", values: bySex([11, 8, 8, 8, 8], [15, 18, 18, 8, 8]) },
  magnesium: { unit: "mg", kind: "rda", values: bySex([410, 400, 420, 420, 420], [360, 310, 320, 320, 320]) },
  zinc: { unit: "mg", kind: "rda", values: bySex([11, 11, 11, 11, 11], [9, 8, 8, 8, 8]) },
  potassium: { unit: "mg", kind: "ai", values: bySex([3000, 3400, 3400, 3400, 3400], [2300, 2600, 2600, 2600, 2600]) },
  sodium: { unit: "mg", kind: "limit", values: bySex([2300, 2300, 2300, 2300, 2300]) },
  iodine: { unit: "mcg", kind: "rda", values: bySex([150, 150, 150, 150, 150]) },
};

export type MicronutrientValue = {
  key: NutrientKey;
  amount: number;
  unit: NutrientUnit;
  kind: DriKind;
};

/** The reference intakes for one sex and age, in NUTRIENTS order. */
export function micronutrients(sex: Sex, age: number): MicronutrientValue[] {
  const band = ageBand(age);
  return NUTRIENTS.map((key) => {
    const ref = DRI[key];
    return { key, amount: ref.values[sex][band], unit: ref.unit, kind: ref.kind };
  });
}

/* ---------------------------------------------------------------------------------------
   The whole result
   --------------------------------------------------------------------------------------- */

export type BodyGoalInput = {
  sex: Sex;
  /** Inside RANGES (as for the other tools). */
  age: number;
  height: number;
  weight: number;
  activity: Activity;
  /** How muscular the visitor is now. */
  muscularity: Muscularity;
  /** How muscular they want to be; until it is set, the same as now. */
  goalMuscularity?: Muscularity;
  /**
   * Goal weight (kg), clamped to `clampGoalWeight()`. Until it is set it is today's weight, unclamped, so
   * the result reads "keep" (the page starts its slider at `suggestGoalWeight()`).
   */
  goalWeight?: number;
};

export type Timeline = {
  /** Whole weeks, ± TIMELINE_SPREAD around |Δkg| ÷ weekly pace. */
  weeksMin: number;
  weeksMax: number;
  /** Whole months, at least 1. */
  monthsMin: number;
  monthsMax: number;
};

export type BodyGoalResult = {
  /** Body fat now (%), one decimal: the Deurenberg estimate plus the muscularity offset. */
  bodyFat: number;
  /** The plain Deurenberg estimate (%), one decimal, for the "how we calculate" text. */
  bodyFatEstimate: number;
  /** Body fat at the goal weight and goal muscularity (%), one decimal. */
  goalBodyFat: number;
  /** Shape names now and at the goal, from the body fat. */
  shape: BodyShape;
  goalShape: BodyShape;
  /** Lean body mass (kg), one decimal. */
  leanMass: number;
  /** Resting energy (kcal), whole: average of Mifflin-St Jeor and Katch-McArdle. */
  bmr: number;
  /** Daily energy at the chosen activity (kcal), rounded to 10. */
  tdee: number;
  /** The goal weight the result is for (kg). */
  goalWeight: number;
  direction: Direction;
  /** Daily calories for the goal, rounded to 10. */
  kcal: number;
  /** True when the goal formula gave less than KCAL_FLOOR and the result was raised to it. */
  floored: boolean;
  /** The floor that applies to this sex. */
  kcalFloor: number;
  /** Expected change in kg a week (two decimals, always positive); null for keep and tone. */
  weeklyKg: number | null;
  /**
   * null unless lose/gain, |Δ| ≥ MIN_TIMELINE_KG and a pace above zero; for a gain, also null above
   * TIMELINE_GAIN_MAX_BMI (TIMELINE_GAIN_MAX_BMI_TRAINED for an athletic or muscular goal).
   */
  timeline: Timeline | null;
  /** Grams a day. */
  protein: number;
  fat: number;
  carbs: number;
  fibre: number;
  /** The weight protein and fat are counted on (kg), one decimal: see `referenceWeight()`. */
  referenceWeight: number;
  /** Protein actually used, g per kg of the reference weight, one decimal. */
  proteinPerKg: number;
  water: WaterResult;
  /** BMI now, its WHO class and the normal weight range for the height. */
  bmi: BmiResult;
  micronutrients: MicronutrientValue[];
};

export function calculateBodyGoal(input: BodyGoalInput): BodyGoalResult {
  const { sex, age, height, weight, activity, muscularity } = input;
  const goalMuscularity = input.goalMuscularity ?? muscularity;
  const goalWeight = input.goalWeight === undefined ? weight : clampGoalWeight(input.goalWeight, height, weight);

  // Body composition, now and at the goal (§0).
  const bodyFat = bodyFatFor({ sex, age, height, weight, muscularity });
  const goalBodyFat = bodyFatFor({ sex, age, height, weight: goalWeight, muscularity: goalMuscularity });
  const leanMass = weight * (1 - bodyFat / 100);
  const shape = bodyShape(sex, bodyFat);

  // Energy (§3.3).
  const bmr = (mifflinStJeor({ sex, age, height, weight }) + katchMcArdle(leanMass)) / 2;
  const tdee = bmr * ACTIVITY_FACTOR[activity];
  const direction = goalDirection({ weight, goalWeight, muscularity, goalMuscularity });

  let target: number;
  switch (direction) {
    case "lose": {
      const weeklyDeficit = LOSS_RATE_PER_WEEK * weight * KCAL_PER_KG;
      target = tdee - Math.min(weeklyDeficit / 7, MAX_DEFICIT_SHARE * tdee);
      break;
    }
    case "tone":
      target = tdee * (1 - TONE_DEFICIT_SHARE);
      break;
    case "keep":
      target = tdee;
      break;
    case "gain": {
      const bigSurplus = goalMuscularity === "muscular" && (shape === "lean" || shape === "fit");
      target = tdee * (1 + (bigSurplus ? MUSCULAR_GAIN_SURPLUS_SHARE : GAIN_SURPLUS_SHARE));
      break;
    }
  }
  const kcalFloor = KCAL_FLOOR[sex];
  const floored = target < kcalFloor;
  const daily = Math.max(target, kcalFloor);
  const kcal = Math.round(daily / 10) * 10;

  // Pace and timeline: the actual daily gap (after the floor) turned into kg a week.
  let pace: number | null = null;
  if (direction === "lose") pace = Math.max(0, ((tdee - daily) * 7) / KCAL_PER_KG);
  else if (direction === "gain") pace = Math.max(0, ((daily - tdee) * 7) / KCAL_PER_KG);
  const change = Math.abs(goalWeight - weight);
  let timeline: Timeline | null = null;
  const trainedGoal = goalMuscularity === "athletic" || goalMuscularity === "muscular";
  const gainBmiLimit = trainedGoal ? TIMELINE_GAIN_MAX_BMI_TRAINED : TIMELINE_GAIN_MAX_BMI;
  const timelineAllowed = direction === "lose" || (direction === "gain" && bmiOf(height, goalWeight) <= gainBmiLimit);
  if (timelineAllowed && pace !== null && pace >= MIN_TIMELINE_PACE_KG && change >= MIN_TIMELINE_KG) {
    const weeks = change / pace;
    const low = weeks * (1 - TIMELINE_SPREAD);
    const high = weeks * (1 + TIMELINE_SPREAD);
    const monthsMin = Math.max(1, Math.round(low / WEEKS_PER_MONTH));
    timeline = {
      weeksMin: Math.max(1, Math.round(low)),
      weeksMax: Math.max(1, Math.round(high)),
      monthsMin,
      monthsMax: Math.max(monthsMin, Math.round(high / WEEKS_PER_MONTH)),
    };
  }

  // Macros (§3.4): the shared rule in src/lib/calculator.ts.
  const refWeight = referenceWeight({ height, weight, goalWeight });
  const macros = splitMacros({
    kcal,
    referenceWeight: refWeight,
    proteinPerKg: Math.min(
      PROTEIN_G_PER_KG[direction] + (goalMuscularity === "muscular" ? MUSCULAR_PROTEIN_EXTRA : 0),
      PROTEIN_MAX_PER_KG,
    ),
  });

  return {
    bodyFat: round1(bodyFat),
    bodyFatEstimate: round1(deurenbergBodyFat({ sex, age, height, weight })),
    goalBodyFat: round1(goalBodyFat),
    shape,
    goalShape: bodyShape(sex, goalBodyFat),
    leanMass: round1(leanMass),
    bmr: Math.round(bmr),
    tdee: Math.round(tdee / 10) * 10,
    goalWeight,
    direction,
    kcal,
    floored,
    kcalFloor,
    weeklyKg: pace === null ? null : Math.round(pace * 100) / 100,
    timeline,
    protein: macros.protein,
    fat: macros.fat,
    carbs: macros.carbs,
    fibre: Math.round((kcal / 1000) * FIBRE_G_PER_1000_KCAL),
    referenceWeight: round1(refWeight),
    proteinPerKg: macros.proteinPerKg,
    water: waterNeed({ weight, activity }),
    bmi: bodyMassIndex({ height, weight }),
    micronutrients: micronutrients(sex, age),
  };
}
