"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BodyFigure } from "@/components/BodyFigure";
import type { Dictionary } from "@/i18n";
import { formatSum, type Locale } from "@/i18n/config";
import { track } from "@/lib/analytics/client";
import {
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
import { ACTIVITIES, RANGES, formatDecimal, recommend, type Activity, type Sex } from "@/lib/calculator";
import { useCountUp } from "@/lib/use-count-up";
import type { CalculatorProgram } from "../Calculator";
import { Option, SliderField } from "../fields";

type Props = {
  locale: Locale;
  t: { calculator: Dictionary["calculator"]; tools: Dictionary["calcTools"] };
  programs: CalculatorProgram[];
  telegramUrl: string;
};

/** Where the sliders start before the visitor moves them (adult averages, rounded). */
const START = {
  age: 30,
  height: { female: 163, male: 176 },
  weight: { female: 62, male: 78 },
} as const satisfies { age: number; height: Record<Sex, number>; weight: Record<Sex, number> };

/** body_calculator_used: once per visit (this tab), as the calorie calculator sends calculator_used. */
const USED_KEY = "taomiq:body_calculator_used";
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
 * The body goal calculator: sex, age, height, weight and muscularity now, a goal weight and muscularity, and
 * activity give daily calories, macros, fibre, water, a calm pace and a program; two figures show "now" and
 * "goal" and change with every slider. Below: the adult vitamin and mineral reference intakes for this sex and age.
 */
export function BodyGoalCalculator({ locale, t, programs, telegramUrl }: Props) {
  const c = t.calculator;
  const tool = t.tools.body;

  const [sex, setSex] = useState<Sex | null>(null);
  // null: not moved yet, so the starting value (which follows the sex) applies.
  const [ageSet, setAge] = useState<number | null>(null);
  const [heightSet, setHeight] = useState<number | null>(null);
  const [weightSet, setWeight] = useState<number | null>(null);
  const [muscularity, setMuscularity] = useState<Muscularity | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [goalWeightSet, setGoalWeight] = useState<number | null>(null);
  const [goalMuscularitySet, setGoalMuscularity] = useState<Muscularity | null>(null);

  const base = sex ?? "female";
  const age = ageSet ?? START.age;
  const height = heightSet ?? START.height[base];
  const weight = weightSet ?? START.weight[base];
  const goalMin = minGoalWeight(height);
  const goalMax = maxGoalWeight(height, weight);
  // Until the visitor moves it, the goal slider sits at a calm first step (src/lib/body-goal.ts) and follows the
  // height and weight; once moved, it stays, held between the BMI 18.5 weight and the higher of today's weight
  // and the BMI 30 weight.
  const goalWeight = clampGoalWeight(goalWeightSet ?? suggestGoalWeight({ height, weight }), height, weight);
  const goalMuscularity = goalMuscularitySet ?? muscularity;

  // The figures need only the sex; until muscularity is picked they show an average build.
  const drawn: { now: Muscularity; goal: Muscularity } = {
    now: muscularity ?? "average",
    goal: goalMuscularity ?? muscularity ?? "average",
  };
  const figures = sex
    ? {
        now: bodyFatFor({ sex, age, height, weight, muscularity: drawn.now }),
        goal: bodyFatFor({ sex, age, height, weight: goalWeight, muscularity: drawn.goal }),
      }
    : null;

  const result =
    sex && muscularity && activity
      ? calculateBodyGoal({
          sex,
          age,
          height,
          weight,
          activity,
          muscularity,
          goalMuscularity: goalMuscularity ?? muscularity,
          goalWeight,
        })
      : null;
  const plan = result ? recommend(programs, result.kcal, DIRECTION_GOAL[result.direction]) : null;
  // The "months to goal" line: always for a loss; for a gain only up to a goal BMI of 25 (27 for an athletic
  // or muscular goal). calculateBodyGoal() leaves `timeline` null otherwise.

  const shownKcal = useCountUp(result?.kcal ?? null);

  // Analytics: the first settled result of this visit for this tool (a no-op without PostHog).
  const resultKcal = result?.kcal ?? null;
  const resultDirection = result?.direction ?? null;
  useEffect(() => {
    if (resultKcal === null || resultDirection === null || usedThisVisit) return;
    const timer = window.setTimeout(() => {
      if (markUsed()) track("body_calculator_used", { kcal: resultKcal, direction: resultDirection, locale });
    }, SETTLED_MS);
    return () => window.clearTimeout(timer);
  }, [resultKcal, resultDirection, locale]);

  // Phones: the mini result bar shows while the result card is further down the page (as on /calculator).
  const card = useRef<HTMLDivElement>(null);
  const [cardBelow, setCardBelow] = useState(false);
  useEffect(() => {
    const el = card.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setCardBelow(!entry.isIntersecting && entry.boundingClientRect.top > 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const barShown = result !== null && cardBelow;

  const macros = result
    ? ([
        [c.protein, result.protein, (result.protein * 4) / result.kcal],
        [c.fat, result.fat, (result.fat * 9) / result.kcal],
        [c.carbs, result.carbs, (result.carbs * 4) / result.kcal],
      ] as const)
    : [];
  const paceText =
    result?.weeklyKg != null && result.weeklyKg > 0
      ? fill(tool.pace, { kg: formatDecimal(result.weeklyKg, result.weeklyKg < 0.25 ? 2 : 1) })
      : null;
  const timelineText =
    result?.timeline
      ? fill(result.timeline.monthsMin === result.timeline.monthsMax ? tool.timelineOne : tool.timeline, {
          min: result.timeline.monthsMin,
          max: result.timeline.monthsMax,
          goal: result.goalWeight,
        })
      : null;
  // Raised to the floor, a keep or tone result no longer matches what the body spends, so these notes give way
  // to the floor note.
  const directionNote =
    !result || result.floored
      ? null
      : result.direction === "tone"
        ? tool.toneNote
        : result.direction === "keep"
          ? tool.keepNote
          : null;
  const flooredNote = result?.floored
    ? fill(
        result.direction === "lose" ? tool.flooredLose : result.direction === "gain" ? tool.flooredGain : tool.flooredKeep,
        { min: formatSum(result.kcalFloor) },
      )
    : null;
  const water = result ? `${formatDecimal(result.water.min)}–${formatDecimal(result.water.max)} ${tool.litres}` : "";

  const announcement = useSettled(
    result
      ? [
          `${tool.resultLabel}: ${formatSum(result.kcal)} ${c.kcal}.`,
          macros.map(([term, grams]) => `${term} ${grams} ${c.grams}`).join(", ") + ".",
          `${tool.direction}: ${tool.directions[result.direction]}.`,
          paceText ? `${paceText}.` : "",
          timelineText ? `${timelineText}.` : "",
          plan ? `${c.planLabel}: ${plan.program.name} ${plan.variant.kcal}.` : c.noPlan,
        ]
          .filter(Boolean)
          .join(" ")
      : "",
    ANNOUNCE_MS,
  );

  const sliderLabels = (label: string) => ({
    decreaseLabel: fill(tool.less, { label }),
    increaseLabel: fill(tool.more, { label }),
  });

  const figureCaption = (side: "now" | "goal") => {
    if (!sex || !figures) return null;
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

  return (
    <section className="container-page grid gap-10 py-10 md:grid-cols-[minmax(0,1fr)_22rem] md:py-14 lg:gap-14">
      {/* While the mini bar can show, the form keeps room below its last control for it. */}
      <form
        className={`grid min-w-0 content-start gap-8 md:col-start-1 md:row-start-1 ${
          result ? "max-md:pb-[calc(5rem+env(safe-area-inset-bottom))]" : ""
        }`}
        onSubmit={(e) => e.preventDefault()}
        noValidate
      >
        <fieldset>
          <legend className="label text-muted">{c.sex}</legend>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
            {(
              [
                ["female", c.female],
                ["male", c.male],
              ] as const
            ).map(([value, title]) => (
              <Option key={value} name="sex" value={value} checked={sex === value} onChange={() => setSex(value)} compact>
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
            data-pinned={sex ? "" : undefined}
            className={`body-figures z-10 overflow-hidden rounded-3xl bg-ivory-deep px-3 pb-1.5 pt-1 sm:pb-3 sm:pt-2 ${
              sex ? "top-[4.5rem] shadow-[0_-1.25rem_0_0_var(--color-ivory),0_6px_16px_-12px_rgb(24_60_52/45%)] lg:top-24 lg:shadow-none [@media(min-height:40rem)]:sticky" : ""
            }`}
          >
            {sex && figures ? (
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
            ) : (
              <p className="px-2 py-6 text-sm leading-relaxed text-muted">{tool.figuresEmpty}</p>
            )}
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
                onChange={setAge}
                {...sliderLabels(c.age)}
              />
              <SliderField
                id="body-height"
                label={c.height}
                unit={c.heightUnit}
                value={height}
                min={RANGES.height.min}
                max={RANGES.height.max}
                onChange={setHeight}
                {...sliderLabels(c.height)}
              />
              <SliderField
                id="body-weight"
                label={c.weight}
                unit={c.weightUnit}
                value={weight}
                min={RANGES.weight.min}
                max={RANGES.weight.max}
                onChange={setWeight}
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
                      onChange={() => setMuscularity(level)}
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
                  <Option key={value} name="activity" value={value} checked={activity === value} onChange={() => setActivity(value)}>
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
                onChange={setGoalWeight}
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
                      onChange={() => setGoalMuscularity(level)}
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
        <div ref={card} className="rounded-3xl bg-forest p-6 text-ivory md:sticky md:top-24">
          <p className="label text-gold">{tool.resultLabel}</p>
          {!result ? (
            <p className="mt-4 leading-relaxed text-ivory/75">{tool.resultEmpty}</p>
          ) : (
            <div className="motion-safe:animate-rise">
              <p className="mt-3 font-serif text-5xl tabular-nums" aria-hidden>
                {formatSum(shownKcal)} <span className="font-sans text-lg text-ivory/70">{c.kcal}</span>
              </p>
              <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-ivory/15 pt-4" aria-hidden>
                {macros.map(([term, grams, ratio]) => (
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
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-ivory/60">{tool.fibre}</dt>
                  <dd className="mt-1 font-semibold tabular-nums">
                    {result.fibre} <span className="text-sm font-normal text-ivory/70">{c.grams}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ivory/60">{tool.water}</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{water}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-ivory/60">
                {fill(tool.proteinPerKg, {
                  value: formatDecimal(result.proteinPerKg),
                  ref: Number.isInteger(result.referenceWeight)
                    ? result.referenceWeight
                    : formatDecimal(result.referenceWeight),
                })}
              </p>

              <div className="mt-5 border-t border-ivory/15 pt-4">
                <p className="text-xs text-ivory/60">{tool.direction}</p>
                <p className="mt-1 font-semibold">{tool.directions[result.direction]}</p>
                {paceText && <p className="mt-1 text-sm text-ivory/80 tabular-nums">{paceText}</p>}
                {timelineText && <p className="mt-1 text-sm text-ivory/80 tabular-nums">{timelineText}</p>}
                {directionNote && <p className="mt-1 text-sm leading-relaxed text-ivory/75">{directionNote}</p>}
                {flooredNote && <p className="mt-3 text-sm leading-relaxed text-ivory/75">{flooredNote}</p>}
              </div>

              <div className="mt-6 border-t border-ivory/15 pt-5">
                {plan ? (
                  <>
                    <p className="label text-gold">{c.planLabel}</p>
                    <span className="mt-4 block h-1 w-8 rounded-full" style={{ background: plan.program.tagColor }} aria-hidden />
                    <p className="mt-3 font-serif text-3xl leading-tight">
                      {plan.program.name} <span className="text-gold">/ {plan.variant.kcal}</span>
                    </p>
                    <p className="mt-2 text-sm text-ivory/70">
                      {c.from} <span className="font-semibold text-ivory">{formatSum(plan.variant.fromPrice)}</span> {c.perDay}
                    </p>
                    <p className="mt-3 text-xs leading-relaxed text-ivory/60">{c.planNote}</p>
                    <Link
                      href={`/${locale}/order?program=${plan.program.slug}&kcal=${plan.variant.kcal}`}
                      className="btn btn-gold mt-5 w-full"
                    >
                      {c.order}
                    </Link>
                    <Link
                      href={`/${locale}/menu?program=${plan.program.slug}&kcal=${plan.variant.kcal}`}
                      className="btn btn-outline mt-3 w-full text-ivory"
                    >
                      {c.menu}
                    </Link>
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
          )}
        </div>
      </aside>

      <Micronutrients sex={sex} age={age} tool={tool} />

      {/* Phones: mini result bar with the order button, once a result exists. */}
      {result && (
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
            {plan ? (
              <Link
                href={`/${locale}/order?program=${plan.program.slug}&kcal=${plan.variant.kcal}`}
                className="btn btn-gold min-h-12 shrink-0 !px-5"
              >
                {c.orderShort}
              </Link>
            ) : (
              <a href={telegramUrl} className="btn btn-gold min-h-12 shrink-0 !px-5" rel="noopener">
                {c.telegram}
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The adult reference intakes of key vitamins and minerals for this sex and age (src/lib/body-goal.ts, DRI), each
 * with everyday local foods; sodium as a limit. Phones: under the result card; from md: under the form.
 */
function Micronutrients({ sex, age, tool }: { sex: Sex | null; age: number; tool: Dictionary["calcTools"]["body"] }) {
  const items: MicronutrientValue[] = sex ? micronutrients(sex, age) : [];
  return (
    <section aria-labelledby="body-vitamins-title" className="min-w-0 md:col-start-1 md:row-start-2">
      <h2 id="body-vitamins-title" className="font-serif text-3xl text-forest">
        {tool.vitaminsTitle}
      </h2>
      {!sex ? (
        <p className="mt-3 leading-relaxed text-muted">{tool.vitaminsEmpty}</p>
      ) : (
        <>
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
        </>
      )}
    </section>
  );
}
