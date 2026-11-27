"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BodyFigure } from "@/components/BodyFigure";
import type { Dictionary } from "@/i18n";
import { formatSum, type Locale } from "@/i18n/config";
import { track } from "@/lib/analytics/client";
import {
  CALCULATOR_DEFAULTS,
  DIRECTION_GOAL,
  MUSCULARITY_LEVELS,
  bodyFatFor,
  bodyLook,
  calculateBodyGoal,
  clampGoalWeight,
  maxGoalWeight,
  micronutrients,
  minGoalWeight,
  suggestGoalWeight,
  type MicronutrientValue,
  type Muscularity,
} from "@/lib/body-goal";
import {
  ACTIVITIES,
  RANGES,
  formatDecimal,
  largestLevelFarBelow,
  recommend,
  type Activity,
  type CalculatorProgram,
  type NumericField,
  type Sex,
} from "@/lib/calculator";
import { useCountUp } from "@/lib/use-count-up";
import { Option, SliderField } from "./fields";

type Props = {
  locale: Locale;
  t: { calculator: Dictionary["calculator"]; tool: Dictionary["bodyGoal"] };
  programs: CalculatorProgram[];
  telegramUrl: string;
};

/** calculator_used: once per visit (this tab), and only for a result the visitor asked for (see `touched`). */
const USED_KEY = "taomiq:calculator_used";
let usedThisVisit = false;
function markUsed(): boolean {
  if (usedThisVisit) return false;
  usedThisVisit = true;
  try {
    if (sessionStorage.getItem(USED_KEY)) return false;
    sessionStorage.setItem(USED_KEY, "1");
  } catch {
    // Storage blocked: the in-memory flag alone.
  }
  return true;
}
/** The result has to stay this long before it counts (or is announced), so a slider in motion is not what gets sent. */
const SETTLED_MS = 1500;
const ANNOUNCE_MS = 700;

/** The value once it has stopped changing for `ms` (screen readers hear the result, not every slider step). */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

/** 2.4 → "2,4", 1300 → "1 300". */
const formatAmount = (value: number) => (Number.isInteger(value) ? formatSum(value) : formatDecimal(value, 1));

/**
 * The calculator: sex, age, height, weight and muscularity now, a goal weight and muscularity, and activity give
 * daily calories, macros, water, BMI, fibre, a calm pace and a program; two figures show "now" and "goal" and change
 * with every slider. Below: the adult vitamin and mineral reference intakes for this sex and age. It opens with an
 * example (CALCULATOR_DEFAULTS), labelled as such, so the result shows at once and the visitor only adjusts it.
 */
export function BodyGoalCalculator({ locale, t, programs, telegramUrl }: Props) {
  const c = t.calculator;
  const tool = t.tool;

  const [sex, setSex] = useState<Sex>(CALCULATOR_DEFAULTS.sex);
  const [age, setAge] = useState<number>(CALCULATOR_DEFAULTS.age);
  const [height, setHeight] = useState<number>(CALCULATOR_DEFAULTS.height);
  const [weight, setWeight] = useState<number>(CALCULATOR_DEFAULTS.weight);
  const [muscularity, setMuscularity] = useState<Muscularity>(CALCULATOR_DEFAULTS.muscularity);
  const [activity, setActivity] = useState<Activity>(CALCULATOR_DEFAULTS.activity);
  // null: not moved yet, so the goal follows the height and weight (suggestGoalWeight) and today's muscularity.
  const [goalWeightSet, setGoalWeight] = useState<number | null>(null);
  const [goalMuscularitySet, setGoalMuscularity] = useState<Muscularity | null>(null);
  // Whether the visitor has changed anything: the example alone is not a result anyone asked for (analytics).
  const [touched, setTouched] = useState(false);
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setTouched(true);
      set(value);
    };

  const goalMin = minGoalWeight(height);
  const goalMax = maxGoalWeight(height, weight);
  // Until the visitor moves it, the goal slider sits at a calm first step (src/lib/body-goal.ts) and follows the
  // height and weight; once moved, it stays, held between the BMI 18.5 weight and the higher of today's weight
  // and the BMI 30 weight.
  const goalWeight = clampGoalWeight(goalWeightSet ?? suggestGoalWeight({ height, weight }), height, weight);
  const goalMuscularity = goalMuscularitySet ?? muscularity;
  const drawn: { now: Muscularity; goal: Muscularity } = { now: muscularity, goal: goalMuscularity };
  const figures = {
    now: bodyFatFor({ sex, age, height, weight, muscularity }),
    goal: bodyFatFor({ sex, age, height, weight: goalWeight, muscularity: goalMuscularity }),
  };

  const result = calculateBodyGoal({ sex, age, height, weight, activity, muscularity, goalMuscularity, goalWeight });
  const plan = recommend(programs, result.kcal, DIRECTION_GOAL[result.direction]);
  // The largest ration, when the norm is 1,000+ kcal above it: one ration alone would leave the visitor far short.
  const largestFar = plan ? largestLevelFarBelow(programs, result.kcal) : null;
  // The "months to goal" line: always for a loss; for a gain only up to a goal BMI of 25 (27 for an athletic
  // or muscular goal). calculateBodyGoal() leaves `timeline` null otherwise.

  // The big number starts at the example's own value (server-rendered), then counts to each new result.
  const [firstKcal] = useState(result.kcal);
  const shownKcal = useCountUp(result.kcal, 700, firstKcal);

  // Analytics: the first settled result of this visit that the visitor asked for, so the untouched example never
  // counts (a no-op without PostHog).
  const resultKcal = result.kcal;
  const resultDirection = result.direction;
  useEffect(() => {
    if (!touched || usedThisVisit) return;
    const timer = window.setTimeout(() => {
      if (markUsed()) track("calculator_used", { kcal: resultKcal, direction: resultDirection, locale });
    }, SETTLED_MS);
    return () => window.clearTimeout(timer);
  }, [touched, resultKcal, resultDirection, locale]);

  // Phones: the mini result bar shows while the result card is further down the page.
  const card = useRef<HTMLDivElement>(null);
  const [barShown, setBarShown] = useState(false);
  useEffect(() => {
    const el = card.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setBarShown(!entry.isIntersecting && entry.boundingClientRect.top > 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fat and carbs side by side; protein, the number visitors ask about most, gets a row of its own above them.
  const minorMacros = [
    [c.fat, result.fat, (result.fat * 9) / result.kcal],
    [c.carbs, result.carbs, (result.carbs * 4) / result.kcal],
  ] as const;
  const proteinShare = (result.protein * 4) / result.kcal;
  const proteinNote = fill(tool.proteinPerKg, {
    value: formatDecimal(result.proteinPerKg),
    ref: Number.isInteger(result.referenceWeight) ? result.referenceWeight : formatDecimal(result.referenceWeight),
  });
  const water = `${formatDecimal(result.water.min)}–${formatDecimal(result.water.max)} ${tool.litres}`;
  const bmiText = `${formatDecimal(result.bmi.bmi)} · ${tool.bmiCategories[result.bmi.category]}`;
  const bmiNormal = fill(tool.bmiNormal, { min: result.bmi.normalMin, max: result.bmi.normalMax });
  const paceText =
    result.weeklyKg != null && result.weeklyKg > 0
      ? fill(tool.pace, { kg: formatDecimal(result.weeklyKg, result.weeklyKg < 0.25 ? 2 : 1) })
      : null;
  const timelineText = result.timeline
    ? fill(result.timeline.monthsMin === result.timeline.monthsMax ? tool.timelineOne : tool.timeline, {
        min: result.timeline.monthsMin,
        max: result.timeline.monthsMax,
        goal: result.goalWeight,
      })
    : null;
  // Raised to the floor, a keep or tone result no longer matches what the body spends, so these notes give way
  // to the floor note.
  const directionNote = result.floored
    ? null
    : result.direction === "tone"
      ? tool.toneNote
      : result.direction === "keep"
        ? tool.keepNote
        : null;
  const flooredNote = result.floored
    ? fill(
        result.direction === "lose" ? tool.flooredLose : result.direction === "gain" ? tool.flooredGain : tool.flooredKeep,
        { min: formatSum(result.kcalFloor) },
      )
    : null;
  const largestNote =
    largestFar !== null
      ? fill(tool.aboveLargest, { gap: formatSum(result.kcal - largestFar), max: formatSum(largestFar) })
      : null;

  const announcement = useSettled(
    [
      `${tool.resultLabel}: ${formatSum(result.kcal)} ${c.kcal}.`,
      `${c.protein} ${result.protein} ${c.grams}, ${c.fat} ${result.fat} ${c.grams}, ${c.carbs} ${result.carbs} ${c.grams}.`,
      `${tool.water}: ${water}.`,
      `${tool.bmi}: ${bmiText}.`,
      `${tool.direction}: ${tool.directions[result.direction]}.`,
      paceText ? `${paceText}.` : "",
      timelineText ? `${timelineText}.` : "",
      plan ? `${c.planLabel}: ${plan.program.name} ${plan.variant.kcal}.` : c.noPlan,
      largestNote ?? "",
    ]
      .filter(Boolean)
      .join(" "),
    ANNOUNCE_MS,
  );

  const sliderLabels = (label: string) => ({
    decreaseLabel: fill(tool.less, { label }),
    increaseLabel: fill(tool.more, { label }),
  });
  // A slider stops at the calculator's range; at either end it says what the range is.
  const rangeHint = (field: NumericField, value: number, unit: string) =>
    value <= RANGES[field].min || value >= RANGES[field].max
      ? fill(tool.rangeNote, { min: RANGES[field].min, max: RANGES[field].max, unit })
      : undefined;

  const figureCaption = (side: "now" | "goal") => {
    const fat = figures[side];
    const kg = side === "now" ? weight : goalWeight;
    return (
      <div className="min-w-0 leading-tight sm:mt-2 sm:text-center">
        <p className="label text-forest">
          <span
            className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${side === "goal" ? "bg-gold" : "bg-sage"}`}
            aria-hidden
          />
          {side === "now" ? tool.now : tool.goal}
        </p>
        <p className="mt-1 text-sm font-semibold text-forest tabular-nums">
          {kg} {c.weightUnit}
          <span className="block font-normal text-graphite">{fill(tool.fat, { fat: Math.round(fat) })}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted">{tool.shapes[bodyLook(sex, fat, drawn[side])]}</p>
      </div>
    );
  };

  const orderHref = plan ? `/${locale}/order?program=${plan.program.slug}&kcal=${plan.variant.kcal}` : null;

  return (
    <section className="container-page grid gap-10 py-10 md:grid-cols-[minmax(0,1fr)_22rem] md:py-14 lg:gap-14">
      {/* The form keeps room below its last control for the phone's mini bar. */}
      <form
        className="grid min-w-0 content-start gap-8 max-md:pb-[calc(5rem+env(safe-area-inset-bottom))] md:col-start-1 md:row-start-1"
        onSubmit={(e) => e.preventDefault()}
        noValidate
      >
        {/* The numbers below are an example, so the result shows at once; the visitor changes them to their own. */}
        <p className="-mb-3 flex items-start gap-2 text-sm leading-relaxed text-muted">
          <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-gold" aria-hidden />
          {tool.example}
        </p>

        <fieldset>
          <legend className="label text-muted">{c.sex}</legend>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
            {(
              [
                ["female", c.female],
                ["male", c.male],
              ] as const
            ).map(([value, title]) => (
              <Option key={value} name="sex" value={value} checked={sex === value} onChange={() => edit(setSex)(value)} compact>
                <span className="block text-center font-semibold">{title}</span>
              </Option>
            ))}
          </div>
        </fieldset>

        <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
          {/* The two figures. On screens at least 40rem tall they stay in view under the header while the sliders
              below move (a landscape phone scrolls them away); the ivory shadow above hides what scrolls under the
              panel's rounded top corners. */}
          <div
            data-pinned=""
            className="body-figures top-[4.5rem] z-10 overflow-hidden rounded-3xl bg-ivory-deep px-3 pb-1.5 pt-1 shadow-[0_-1.25rem_0_0_var(--color-ivory),0_6px_16px_-12px_rgb(24_60_52/45%)] sm:pb-3 sm:pt-2 lg:top-24 lg:shadow-none [@media(min-height:40rem)]:sticky"
          >
            <div className="grid grid-cols-2 gap-2">
              {(["now", "goal"] as const).map((side) => (
                // Phones: the caption beside the figure, so the figure can be taller in the same height.
                <div key={side} className="flex min-w-0 items-center gap-2 sm:block">
                  <BodyFigure
                    sex={sex}
                    bodyFat={figures[side]}
                    muscularity={drawn[side]}
                    height={height}
                    accent={side === "goal" ? "gold" : "sage"}
                    rulerLabels={side === "now"}
                    className="block h-52 w-[4.2rem] shrink-0 sm:mx-auto sm:h-56 sm:w-full lg:h-[19rem]"
                  />
                  {figureCaption(side)}
                </div>
              ))}
            </div>
          </div>

          <div className="grid min-w-0 gap-10">
            <div role="group" aria-labelledby="body-now-title" className="grid gap-6">
              <h2 id="body-now-title" className="font-serif text-2xl text-forest">
                {tool.nowTitle}
              </h2>
              <SliderField
                id="body-age"
                label={c.age}
                unit={c.ageUnit}
                value={age}
                min={RANGES.age.min}
                max={RANGES.age.max}
                onChange={edit(setAge)}
                hint={fill(tool.ageNote, { min: RANGES.age.min, max: RANGES.age.max })}
                {...sliderLabels(c.age)}
              />
              <SliderField
                id="body-height"
                label={c.height}
                unit={c.heightUnit}
                value={height}
                min={RANGES.height.min}
                max={RANGES.height.max}
                onChange={edit(setHeight)}
                hint={rangeHint("height", height, c.heightUnit)}
                {...sliderLabels(c.height)}
              />
              <SliderField
                id="body-weight"
                label={c.weight}
                unit={c.weightUnit}
                value={weight}
                min={RANGES.weight.min}
                max={RANGES.weight.max}
                onChange={edit(setWeight)}
                hint={rangeHint("weight", weight, c.weightUnit)}
                {...sliderLabels(c.weight)}
              />
              <fieldset>
                <legend className="label text-muted">{tool.muscularity}</legend>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {MUSCULARITY_LEVELS.map((level) => (
                    <Option
                      key={level}
                      name="muscularity"
                      value={level}
                      checked={muscularity === level}
                      onChange={() => edit(setMuscularity)(level)}
                      compact
                    >
                      <span className="block font-semibold">{tool.muscularityLevels[level].title}</span>
                      <span className="mt-0.5 block text-xs opacity-75">{tool.muscularityLevels[level].hint}</span>
                    </Option>
                  ))}
                </div>
              </fieldset>
            </div>

            <fieldset>
              <legend className="label text-muted">{c.activity}</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {ACTIVITIES.map((value) => (
                  <Option
                    key={value}
                    name="activity"
                    value={value}
                    checked={activity === value}
                    onChange={() => edit(setActivity)(value)}
                  >
                    <span className="block font-semibold">{c.activities[value].title}</span>
                    <span className="mt-0.5 block text-sm opacity-75">{c.activities[value].hint}</span>
                  </Option>
                ))}
              </div>
            </fieldset>

            <div role="group" aria-labelledby="body-goal-title" className="grid gap-6">
              <h2 id="body-goal-title" className="font-serif text-2xl text-forest">
                {tool.goalTitle}
              </h2>
              <SliderField
                id="body-goal-weight"
                label={tool.goalWeight}
                unit={c.weightUnit}
                value={goalWeight}
                min={goalMin}
                max={goalMax}
                onChange={edit(setGoalWeight)}
                hint={goalWeight <= goalMin ? fill(tool.goalMin, { min: goalMin }) : undefined}
                {...sliderLabels(tool.goalWeight)}
              />
              <fieldset>
                <legend className="label text-muted">{tool.goalMuscularity}</legend>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {MUSCULARITY_LEVELS.map((level) => (
                    <Option
                      key={level}
                      name="goal-muscularity"
                      value={level}
                      checked={goalMuscularity === level}
                      onChange={() => edit(setGoalMuscularity)(level)}
                      compact
                    >
                      <span className="block text-center font-semibold">{tool.muscularityLevels[level].title}</span>
                    </Option>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
        </div>
      </form>

      <aside className="md:col-start-2 md:row-span-2 md:row-start-1">
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
        {/* The result card, top to bottom: calories, protein, fat and carbs, water, BMI, fibre, the pace, the plan. */}
        <div ref={card} className="rounded-3xl bg-forest p-6 text-ivory md:sticky md:top-24">
          <p className="label text-gold">{tool.resultLabel}</p>
          {/* The counting figure and the macro bars are hidden from screen readers: the live region reads the result. */}
          <p className="mt-3 font-serif text-5xl tabular-nums" aria-hidden>
            {formatSum(shownKcal)} <span className="font-sans text-lg text-ivory/70">{c.kcal}</span>
          </p>

          <div className="mt-5 border-t border-ivory/15 pt-4">
            <div aria-hidden>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-ivory/70">{c.protein}</p>
                <p className="font-serif text-3xl leading-none tabular-nums">
                  {result.protein} <span className="font-sans text-base text-ivory/70">{c.grams}</span>
                </p>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-ivory/15">
                <span
                  className="grow-x grow-live block h-full rounded-full bg-gold"
                  style={{ "--bar": Math.min(proteinShare, 1).toFixed(3) } as CSSProperties}
                />
              </div>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ivory/60">{proteinNote}</p>
          </div>

          <div>
            <dl className="mt-4 grid grid-cols-2 gap-3" aria-hidden>
              {minorMacros.map(([term, grams, ratio]) => (
                <div key={term}>
                  <dt className="text-xs text-ivory/60">{term}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {grams} <span className="text-sm font-normal text-ivory/70">{c.grams}</span>
                  </dd>
                  <dd className="mt-2 h-1 overflow-hidden rounded-full bg-ivory/15">
                    <span
                      className="grow-x grow-live block h-full rounded-full bg-gold"
                      style={{ "--bar": Math.min(ratio, 1).toFixed(3) } as CSSProperties}
                    />
                  </dd>
                </div>
              ))}
            </dl>

            <dl className="mt-5 divide-y divide-ivory/15 border-y border-ivory/15">
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="text-sm text-ivory/70">{tool.water}</dt>
                <dd className="font-semibold tabular-nums">{water}</dd>
              </div>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 py-2.5">
                <dt className="text-sm text-ivory/70">{tool.bmi}</dt>
                <dd className="text-right font-semibold tabular-nums">{bmiText}</dd>
                <dd className="col-span-2 mt-1 text-xs leading-relaxed text-ivory/60 tabular-nums">{bmiNormal}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="text-sm text-ivory/70">{tool.fibre}</dt>
                <dd className="font-semibold tabular-nums">
                  {result.fibre} <span className="text-sm font-normal text-ivory/70">{c.grams}</span>
                </dd>
              </div>
            </dl>

            <div className="mt-4">
              <p className="text-xs text-ivory/60">{tool.direction}</p>
              <p className="mt-1 font-semibold">{tool.directions[result.direction]}</p>
              {paceText && <p className="mt-1 text-sm text-ivory/80 tabular-nums">{paceText}</p>}
              {timelineText && <p className="mt-1 text-sm text-ivory/80 tabular-nums">{timelineText}</p>}
              {directionNote && <p className="mt-1 text-sm leading-relaxed text-ivory/75">{directionNote}</p>}
              {flooredNote && <p className="mt-3 text-sm leading-relaxed text-ivory/75">{flooredNote}</p>}
            </div>
          </div>

          <div className="mt-6 border-t border-ivory/15 pt-5">
            {plan && orderHref ? (
              <>
                <p className="label text-gold">{c.planLabel}</p>
                <span className="mt-4 block h-1 w-8 rounded-full" style={{ background: plan.program.tagColor }} aria-hidden />
                <p className="mt-3 font-serif text-3xl leading-tight">
                  {plan.program.name} <span className="text-gold">/ {plan.variant.kcal}</span>
                </p>
                <p className="mt-2 text-sm text-ivory/70">
                  {c.from} <span className="font-semibold text-ivory">{formatSum(plan.variant.fromPrice)}</span> {c.perDay}
                </p>
                {largestNote ? (
                  <p className="mt-3 text-sm leading-relaxed text-ivory/85">{largestNote}</p>
                ) : (
                  <p className="mt-3 text-xs leading-relaxed text-ivory/60">{c.planNote}</p>
                )}
                <Link href={orderHref} className="btn btn-gold mt-5 w-full">
                  {c.order}
                </Link>
                {largestNote ? (
                  <a href={telegramUrl} className="btn btn-outline mt-3 w-full text-ivory" rel="noopener">
                    {c.telegram}
                  </a>
                ) : (
                  <Link
                    href={`/${locale}/menu?program=${plan.program.slug}&kcal=${plan.variant.kcal}`}
                    className="btn btn-outline mt-3 w-full text-ivory"
                  >
                    {c.menu}
                  </Link>
                )}
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-ivory/75">{c.noPlan}</p>
                <a href={telegramUrl} className="btn btn-gold mt-4 w-full" rel="noopener">
                  {c.telegram}
                </a>
              </>
            )}
          </div>
        </div>
      </aside>

      <Micronutrients sex={sex} age={age} tool={tool} />

      {/* Phones: mini result bar with the order button, while the result card is out of view below. */}
      <div
        className={`calc-bar fixed inset-x-0 bottom-0 z-30 border-t border-ivory/10 bg-forest text-ivory transition-[translate] duration-[var(--duration-base)] ease-out-calm starting:translate-y-full md:hidden ${
          barShown ? "" : "translate-y-full"
        }`}
        data-shown={barShown || undefined}
        inert={!barShown}
      >
        <div className="container-page flex items-center justify-between gap-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="min-w-0">
            <p className="font-serif text-xl leading-tight tabular-nums">
              ≈ {formatSum(result.kcal)} <span className="font-sans text-sm text-ivory/70">{c.kcal}</span>
            </p>
            <p className="label mt-0.5 truncate text-gold">
              {plan ? `${plan.program.name} / ${plan.variant.kcal}` : tool.directions[result.direction]}
            </p>
          </div>
          {orderHref ? (
            <Link href={orderHref} className="btn btn-gold min-h-12 shrink-0 !px-5">
              {c.orderShort}
            </Link>
          ) : (
            <a href={telegramUrl} className="btn btn-gold min-h-12 shrink-0 !px-5" rel="noopener">
              {c.telegram}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The adult reference intakes of key vitamins and minerals for this sex and age (src/lib/body-goal.ts, DRI), each
 * with everyday local foods; sodium as a limit. Phones: under the result card; from md: under the form.
 */
function Micronutrients({ sex, age, tool }: { sex: Sex; age: number; tool: Dictionary["bodyGoal"] }) {
  const items: MicronutrientValue[] = micronutrients(sex, age);
  return (
    <section aria-labelledby="body-vitamins-title" className="min-w-0 md:col-start-1 md:row-start-2">
      <h2 id="body-vitamins-title" className="font-serif text-3xl text-forest">
        {tool.vitaminsTitle}
      </h2>
      <p className="mt-3 max-w-2xl leading-relaxed text-graphite">{tool.vitaminsLead}</p>
      <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
        {items.map((item) => {
          const copy = tool.nutrients[item.key];
          const amount = `${formatAmount(item.amount)} ${tool.units[item.unit]}`;
          return (
            <li key={item.key} className="border-b border-line py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-forest">{copy.name}</span>
                <span className="shrink-0 text-right font-semibold text-forest tabular-nums">
                  {item.kind === "limit" && <span className="font-normal text-muted">{tool.limit} </span>}
                  {amount}
                  {item.kind === "ai" && (
                    <>
                      <span aria-hidden>*</span>
                      <span className="sr-only"> {tool.aiLabel}</span>
                    </>
                  )}
                </span>
              </div>
              <p className="mt-1 text-sm leading-snug text-muted">{copy.foods}</p>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 text-xs leading-relaxed text-muted">{tool.driNote}</p>
      <p className="mt-3 text-sm leading-relaxed text-graphite">{tool.healthNote}</p>
    </section>
  );
}
