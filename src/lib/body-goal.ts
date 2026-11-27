/**
 * Body goal calculator (/calculator/body): the visitor picks the body closest to theirs now and the one
 * they want, and gets calories, macros, fibre, water, a calm pace and the adult reference intakes of key
 * vitamins and minerals. Pure functions, no UI; plan in docs/plans/body-goal-calculator.md §3.
 *
 * Every number here is an estimate for healthy adults (18–80) choosing a ration, not a medical or
 * diet prescription. A picture is only a rough body-fat band, so it is cross-checked against a
 * height/weight/age formula before it is used.
 */

import {
  ACTIVITY_FACTOR,
  BMI_NORMAL,
  RANGES,
  waterNeed,
  type Activity,
  type Goal,
  type Sex,
  type WaterResult,
} from "@/lib/calculator";

/* ---------------------------------------------------------------------------------------
   §3.1 Body type pictures → body-fat band
   --------------------------------------------------------------------------------------- */

/** The five "closest to your body now" pictures per sex, ordered lean → heavy. */
export type BodyType = "lean" | "fit" | "average" | "soft" | "heavy";
/** The goal row: the same five plus "muscular" (a higher lean-mass target). */
export type GoalBodyType = BodyType | "muscular";

export const BODY_TYPES: readonly BodyType[] = ["lean", "fit", "average", "soft", "heavy"];
export const GOAL_BODY_TYPES: readonly GoalBodyType[] = [...BODY_TYPES, "muscular"];

/** Body fat in % of body weight: the band a picture stands for, and the midpoint used in the maths. */
export type BodyFatBand = {
  min: number;
  /** null for the open-ended top band ("32 % and more"). */
  max: number | null;
  mid: number;
};

/**
 * Body-fat bands per picture. A picture is a rough band, not a measurement (even photo algorithms need
 * DXA calibration: Majmudar et al. 2022, npj Digit Med; Shape Up! Adults, 2021), hence the cross-check
 * in `bodyFatUsed()`.
 */
export const BODY_FAT_BANDS: Record<Sex, Record<GoalBodyType, BodyFatBand>> = {
  male: {
    lean: { min: 8, max: 12, mid: 10 },
    fit: { min: 13, max: 17, mid: 15 },
    average: { min: 18, max: 24, mid: 21 },
    soft: { min: 25, max: 31, mid: 28 },
    heavy: { min: 32, max: null, mid: 35 },
    muscular: { min: 10, max: 14, mid: 12 },
  },
  female: {
    lean: { min: 15, max: 19, mid: 17 },
    fit: { min: 20, max: 24, mid: 22 },
    average: { min: 25, max: 31, mid: 28 },
    soft: { min: 32, max: 38, mid: 35 },
    heavy: { min: 39, max: null, mid: 42 },
    muscular: { min: 18, max: 22, mid: 20 },
  },
};

/**
 * Lean mass (kg) the "muscular" goal adds on top of today's lean mass when suggesting a goal weight:
 * roughly what a beginner who trains regularly can build in the first several months. An assumption
 * for the slider's starting point only; the visitor moves the slider.
 */
export const MUSCULAR_LEAN_GAIN_KG: Record<Sex, number> = { male: 3, female: 1.5 };

/* ---------------------------------------------------------------------------------------
   §3.2 Cross-check
   --------------------------------------------------------------------------------------- */

/** The picture midpoint may differ from the formula estimate by at most this many points. */
export const BODY_FAT_CROSSCHECK_POINTS = 8;
/** Absolute guard on the body fat used (%), so the lean-mass maths never breaks at the extremes. */
const BODY_FAT_LIMITS = { min: 5, max: 60 } as const;

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
 * The body fat (%) the calculator works with: the picture's midpoint, clamped to the Deurenberg estimate
 * ± 8 points. A 120 kg visitor who taps "lean" still gets sane numbers, and a muscular 95 kg visitor who
 * taps "fit" is not treated as obese.
 */
export function bodyFatUsed(input: {
  sex: Sex;
  age: number;
  height: number;
  weight: number;
  bodyType: BodyType;
}): number {
  const estimate = deurenbergBodyFat(input);
  const picture = BODY_FAT_BANDS[input.sex][input.bodyType].mid;
  const crossChecked = clamp(
    picture,
    estimate - BODY_FAT_CROSSCHECK_POINTS,
    estimate + BODY_FAT_CROSSCHECK_POINTS,
  );
  return clamp(crossChecked, BODY_FAT_LIMITS.min, BODY_FAT_LIMITS.max);
}

/* ---------------------------------------------------------------------------------------
   Goal weight: the slider's lower stop and its suggested starting point
   --------------------------------------------------------------------------------------- */

/** The lowest goal weight (whole kg) offered: BMI 18.5 at this height (WHO), never under the input range. */
export function minGoalWeight(height: number): number {
  return Math.max(RANGES.weight.min, Math.ceil(BMI_NORMAL.min * (height / 100) ** 2));
}

/** A goal weight kept inside [minGoalWeight, RANGES.weight.max]. */
export function clampGoalWeight(goalWeight: number, height: number): number {
  return clamp(goalWeight, minGoalWeight(height), RANGES.weight.max);
}

/**
 * Suggested goal weight (whole kg) for a goal picture: keep today's lean mass (plus
 * MUSCULAR_LEAN_GAIN_KG for "muscular") and solve for the goal picture's body-fat midpoint,
 * `goal = LBM / (1 − goal BF)`. The same picture as today keeps today's weight. Clamped to
 * `clampGoalWeight()`.
 */
export function suggestGoalWeight(input: {
  sex: Sex;
  age: number;
  height: number;
  weight: number;
  currentType: BodyType;
  goalType: GoalBodyType;
}): number {
  if (input.goalType === input.currentType) {
    return clampGoalWeight(Math.round(input.weight), input.height);
  }
  const leanMass = input.weight * (1 - bodyFatUsed({ ...input, bodyType: input.currentType }) / 100);
  const targetLean = leanMass + (input.goalType === "muscular" ? MUSCULAR_LEAN_GAIN_KG[input.sex] : 0);
  const goalFat = BODY_FAT_BANDS[input.sex][input.goalType].mid / 100;
  return clampGoalWeight(Math.round(targetLean / (1 - goalFat)), input.height);
}

/* ---------------------------------------------------------------------------------------
   §3.3 Energy
   --------------------------------------------------------------------------------------- */

/**
 * lose: goal weight more than 1 kg under today's · gain: more than 1 kg over · tone: about the same
 * weight but a leaner or muscular goal picture · keep: about the same weight and picture.
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
/** Toning (same weight, leaner): a small 10 % deficit. */
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
const WEEKS_PER_MONTH = 52 / 12;

/** Resting energy, Mifflin-St Jeor 1990: `10 × kg + 6.25 × cm − 5 × age + (male ? 5 : −161)`. */
export function mifflinStJeor(input: { sex: Sex; age: number; height: number; weight: number }): number {
  return 10 * input.weight + 6.25 * input.height - 5 * input.age + (input.sex === "male" ? 5 : -161);
}

/** Resting energy from lean body mass, Katch-McArdle: `370 + 21.6 × LBM`. */
export function katchMcArdle(leanMass: number): number {
  return 370 + 21.6 * leanMass;
}

/** Direction from goal weight vs today's and the two pictures. */
export function goalDirection(input: {
  weight: number;
  goalWeight: number;
  currentType: BodyType;
  goalType: GoalBodyType;
}): Direction {
  const delta = input.goalWeight - input.weight;
  if (delta < -SAME_WEIGHT_KG) return "lose";
  if (delta > SAME_WEIGHT_KG) return "gain";
  const leaner =
    input.goalType === "muscular" ||
    BODY_TYPES.indexOf(input.goalType) < BODY_TYPES.indexOf(input.currentType);
  return leaner ? "tone" : "keep";
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
 * Protein, g per kg of **goal** weight (avoids absurd numbers for heavier people): 1.6 g/kg is where
 * muscle gains plateau (Morton et al., Br J Sports Med 2018); 2.0 in a deficit keeps muscle
 * (Helms et al., JISSN 2014, 1.8–2.2). A "muscular" goal adds 0.2; never above 2.2 (Morton's upper range).
 */
export const PROTEIN_G_PER_KG: Record<Direction, number> = { lose: 2.0, tone: 2.0, keep: 1.6, gain: 1.6 };
export const MUSCULAR_PROTEIN_EXTRA = 0.2;
export const PROTEIN_CAP_G_PER_KG = 2.2;
/** If carbs would fall under the RDA (130 g, below), protein may drop to this, never lower. */
export const PROTEIN_MIN_G_PER_KG = 1.6;
/**
 * Fat: 0.8 g per kg of goal weight, kept within 25–35 % of calories (35 % is the top of the adult
 * Acceptable Macronutrient Distribution Range, National Academies 2002/2005).
 */
export const FAT_G_PER_KG = 0.8;
export const FAT_MIN_SHARE = 0.25;
export const FAT_MAX_SHARE = 0.35;
/** Carbohydrate RDA for adults (National Academies DRI, 2002/2005): the brain's minimum glucose. */
export const CARBS_MIN_G = 130;
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
  /** The picture closest to the visitor's body now. */
  currentType: BodyType;
  /** The picture they want; before it is picked, the same as today. */
  goalType?: GoalBodyType;
  /**
   * Goal weight (kg). Given or suggested weights are clamped to `clampGoalWeight()`. Before any goal
   * is picked (no goalType, no goalWeight) it is today's weight, unclamped, so the result reads "keep".
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
  /** Body fat used (%), one decimal: picture midpoint after the cross-check. */
  bodyFat: number;
  /** The Deurenberg estimate (%), one decimal, for the "how we calculate" text. */
  bodyFatEstimate: number;
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
  /** null unless lose/gain, |Δ| ≥ MIN_TIMELINE_KG and a pace above zero. */
  timeline: Timeline | null;
  /** Grams a day. */
  protein: number;
  fat: number;
  carbs: number;
  fibre: number;
  /** Protein actually used, g per kg of goal weight, one decimal. */
  proteinPerKg: number;
  water: WaterResult;
  micronutrients: MicronutrientValue[];
};

export function calculateBodyGoal(input: BodyGoalInput): BodyGoalResult {
  const { sex, age, height, weight, activity, currentType } = input;
  const goalType = input.goalType ?? currentType;

  // Body composition (§3.1–3.2).
  const bodyFat = bodyFatUsed({ sex, age, height, weight, bodyType: currentType });
  const leanMass = weight * (1 - bodyFat / 100);

  // Goal weight.
  let goalWeight: number;
  if (input.goalWeight !== undefined) goalWeight = clampGoalWeight(input.goalWeight, height);
  else if (input.goalType !== undefined)
    goalWeight = suggestGoalWeight({ sex, age, height, weight, currentType, goalType });
  else goalWeight = weight;

  // Energy (§3.3).
  const bmr = (mifflinStJeor({ sex, age, height, weight }) + katchMcArdle(leanMass)) / 2;
  const tdee = bmr * ACTIVITY_FACTOR[activity];
  const direction = goalDirection({ weight, goalWeight, currentType, goalType });

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
      const bigSurplus = goalType === "muscular" && (currentType === "lean" || currentType === "fit");
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
  if (pace !== null && pace >= MIN_TIMELINE_PACE_KG && change >= MIN_TIMELINE_KG) {
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

  // Macros (§3.4): protein on goal weight, fat 0.8 g/kg within 25–35 % of calories, carbs the rest.
  // If carbs would fall under their RDA, fat gives way first (down to 25 %), then protein (down to
  // PROTEIN_MIN_G_PER_KG); a very low calorie level can still leave carbs under 130 g.
  const proteinPerKgTarget = Math.min(
    PROTEIN_G_PER_KG[direction] + (goalType === "muscular" ? MUSCULAR_PROTEIN_EXTRA : 0),
    PROTEIN_CAP_G_PER_KG,
  );
  const fatMin = (FAT_MIN_SHARE * kcal) / 9;
  const fatMax = (FAT_MAX_SHARE * kcal) / 9;
  let fatGrams = clamp(FAT_G_PER_KG * goalWeight, fatMin, fatMax);
  let proteinGrams = proteinPerKgTarget * goalWeight;
  const carbGap = () => CARBS_MIN_G - (kcal - 4 * proteinGrams - 9 * fatGrams) / 4;
  if (carbGap() > 0) fatGrams = Math.max(fatMin, fatGrams - (carbGap() * 4) / 9);
  if (carbGap() > 0) proteinGrams = Math.max(PROTEIN_MIN_G_PER_KG * goalWeight, proteinGrams - carbGap());
  const protein = Math.round(proteinGrams);
  const fat = Math.round(fatGrams);
  const carbs = Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4));

  return {
    bodyFat: round1(bodyFat),
    bodyFatEstimate: round1(deurenbergBodyFat({ sex, age, height, weight })),
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
    protein,
    fat,
    carbs,
    fibre: Math.round((kcal / 1000) * FIBRE_G_PER_1000_KCAL),
    proteinPerKg: round1(proteinGrams / goalWeight),
    water: waterNeed({ weight, activity }),
    micronutrients: micronutrients(sex, age),
  };
}
