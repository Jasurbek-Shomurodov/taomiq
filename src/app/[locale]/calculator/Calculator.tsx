"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Dictionary } from "@/i18n";
import { formatSum, type Locale } from "@/i18n/config";
import { track } from "@/lib/analytics/client";
import {
  ACTIVITIES,
  GOALS,
  MIN_KCAL,
  RANGES,
  calculate,
  parseField,
  recommend,
  type Activity,
  type Goal,
  type NumericField,
  type Sex,
} from "@/lib/calculator";
import { useCountUp } from "@/lib/use-count-up";
import { Option } from "./fields";

export type CalculatorProgram = {
  slug: string;
  name: string;
  tagColor: string;
  variants: { kcal: number; fromPrice: number }[];
};

type Props = {
  locale: Locale;
  t: Dictionary["calculator"];
  programs: CalculatorProgram[];
  telegramUrl: string;
};

const NUMERIC_FIELDS: readonly NumericField[] = ["age", "height", "weight"];

/** calculator_used is sent once per visit (this tab); the flag survives client navigations and, if allowed, reloads. */
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
/** The result has to stay this long before it counts, so a half-typed number is not what gets sent. */
const SETTLED_MS = 1500;

export function Calculator({ locale, t, programs, telegramUrl }: Props) {
  const [sex, setSex] = useState<Sex | null>(null);
  const [values, setValues] = useState<Record<NumericField, string>>({ age: "", height: "", weight: "" });
  // A range error shows only after the visitor leaves the field.
  const [blurred, setBlurred] = useState<ReadonlySet<NumericField>>(new Set());
  const [activity, setActivity] = useState<Activity | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);

  const parsed = {
    age: parseField("age", values.age),
    height: parseField("height", values.height),
    weight: parseField("weight", values.weight),
  };
  const showError = (field: NumericField) => blurred.has(field) && values[field].trim() !== "" && parsed[field] === null;

  const result =
    sex && activity && goal && parsed.age !== null && parsed.height !== null && parsed.weight !== null
      ? calculate({ sex, age: parsed.age, height: parsed.height, weight: parsed.weight, activity, goal })
      : null;
  const plan = result && goal ? recommend(programs, result.kcal, goal) : null;

  // The big number counts from the previous result to the new one; screen readers get the final
  // value only, from the live region below.
  const shownKcal = useCountUp(result?.kcal ?? null);

  // Analytics: the first settled result of this visit (src/lib/analytics/client.ts; a no-op without PostHog).
  const resultKcal = result?.kcal ?? null;
  useEffect(() => {
    if (resultKcal === null || usedThisVisit) return;
    const timer = window.setTimeout(() => {
      if (markUsed()) track("calculator_used", { kcal: resultKcal, locale });
    }, SETTLED_MS);
    return () => window.clearTimeout(timer);
  }, [resultKcal, locale]);

  // Phones: the mini result bar shows while the result card is still further down the page, and
  // hides once the card is on screen or scrolled past (it never sits over the footer).
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
        [t.protein, result.protein, (result.protein * 4) / result.kcal],
        [t.fat, result.fat, (result.fat * 9) / result.kcal],
        [t.carbs, result.carbs, (result.carbs * 4) / result.kcal],
      ] as const)
    : [];
  const announcement = result
    ? [
        `${t.resultLabel}: ${formatSum(result.kcal)} ${t.kcal}.`,
        macros.map(([term, grams]) => `${term} ${grams} ${t.grams}`).join(", ") + ".",
        plan ? `${t.planLabel}: ${plan.program.name} ${plan.variant.kcal}.` : t.noPlan,
      ].join(" ")
    : "";

  const labels: Record<NumericField, { label: string; unit: string }> = {
    age: { label: t.age, unit: t.ageUnit },
    height: { label: t.height, unit: t.heightUnit },
    weight: { label: t.weight, unit: t.weightUnit },
  };

  return (
    <section className="container-page grid gap-10 py-10 md:grid-cols-[minmax(0,1fr)_22rem] md:py-14 lg:gap-14">
      {/* While the mini bar can show, the form keeps room below its last control for it. */}
      <form
        className={`grid min-w-0 gap-10 ${result ? "max-md:pb-[calc(5rem+env(safe-area-inset-bottom))]" : ""}`}
        onSubmit={(e) => e.preventDefault()}
        noValidate
      >
        <fieldset>
          <legend className="label text-muted">{t.sex}</legend>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
            {(
              [
                ["female", t.female],
                ["male", t.male],
              ] as const
            ).map(([value, title]) => (
              <Option key={value} name="sex" value={value} checked={sex === value} onChange={() => setSex(value)} compact>
                <span className="block text-center font-semibold">{title}</span>
              </Option>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-3 gap-3 sm:max-w-lg">
          {NUMERIC_FIELDS.map((field) => {
            const id = `calc-${field}`;
            const invalid = showError(field);
            return (
              <div key={field} className="min-w-0">
                <label htmlFor={id} className="label text-muted">
                  {labels[field].label}
                </label>
                <div
                  className={`field mt-2 flex items-center gap-1 !p-0 focus-within:border-forest ${
                    invalid ? "!border-danger" : ""
                  }`}
                >
                  <input
                    id={id}
                    name={field}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={3}
                    value={values[field]}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
                      setValues((prev) => ({ ...prev, [field]: digits }));
                    }}
                    onBlur={() => setBlurred((prev) => (prev.has(field) ? prev : new Set(prev).add(field)))}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? `${id}-error` : undefined}
                    className="w-full min-w-0 rounded-l-[0.6rem] bg-transparent py-[0.6rem] pl-3 font-semibold text-forest tabular-nums outline-none"
                  />
                  <span className="pr-3 text-sm text-muted" aria-hidden>
                    {labels[field].unit}
                  </span>
                </div>
                {invalid && (
                  <p id={`${id}-error`} className="mt-2 text-sm font-semibold text-danger">
                    {t.rangeError.replace("{min}", String(RANGES[field].min)).replace("{max}", String(RANGES[field].max))}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <fieldset>
          <legend className="label text-muted">{t.activity}</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {ACTIVITIES.map((value) => (
              <Option
                key={value}
                name="activity"
                value={value}
                checked={activity === value}
                onChange={() => setActivity(value)}
              >
                <span className="block font-semibold">{t.activities[value].title}</span>
                <span className="mt-0.5 block text-sm opacity-75">{t.activities[value].hint}</span>
              </Option>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="label text-muted">{t.goal}</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {GOALS.map((value) => (
              <Option key={value} name="goal" value={value} checked={goal === value} onChange={() => setGoal(value)}>
                <span className="block font-semibold">{t.goals[value].title}</span>
                <span className="mt-0.5 block text-sm opacity-75">{t.goals[value].hint}</span>
              </Option>
            ))}
          </div>
        </fieldset>
      </form>

      <aside>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
        <div ref={card} className="rounded-3xl bg-forest p-6 text-ivory md:sticky md:top-24">
          {!result ? (
            <>
              <p className="label text-gold">{t.resultLabel}</p>
              <p className="mt-4 leading-relaxed text-ivory/75">{t.resultEmpty}</p>
            </>
          ) : (
            <div className="motion-safe:animate-rise">
              <p className="label text-gold">{t.resultLabel}</p>
              <p className="mt-3 font-serif text-5xl tabular-nums" aria-hidden>
                {formatSum(shownKcal)} <span className="font-sans text-lg text-ivory/70">{t.kcal}</span>
              </p>
              <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-ivory/15 pt-4" aria-hidden>
                {macros.map(([term, grams, ratio]) => (
                  <div key={term}>
                    <dt className="text-xs text-ivory/60">{term}</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">
                      {grams} <span className="text-sm font-normal text-ivory/70">{t.grams}</span>
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
              {result.floored && (
                <p className="mt-4 text-sm leading-relaxed text-ivory/75">
                  {t.floored.replace("{min}", String(MIN_KCAL))}
                </p>
              )}

              <div className="mt-6 border-t border-ivory/15 pt-5">
                {plan ? (
                  <>
                    <p className="label text-gold">{t.planLabel}</p>
                    <span
                      className="mt-4 block h-1 w-8 rounded-full"
                      style={{ background: plan.program.tagColor }}
                      aria-hidden
                    />
                    <p className="mt-3 font-serif text-3xl leading-tight">
                      {plan.program.name} <span className="text-gold">/ {plan.variant.kcal}</span>
                    </p>
                    <p className="mt-2 text-sm text-ivory/70">
                      {t.from} <span className="font-semibold text-ivory">{formatSum(plan.variant.fromPrice)}</span>{" "}
                      {t.perDay}
                    </p>
                    <p className="mt-3 text-xs leading-relaxed text-ivory/60">{t.planNote}</p>
                    <Link
                      href={`/${locale}/order?program=${plan.program.slug}&kcal=${plan.variant.kcal}`}
                      className="btn btn-gold mt-5 w-full"
                    >
                      {t.order}
                    </Link>
                    <Link
                      href={`/${locale}/menu?program=${plan.program.slug}&kcal=${plan.variant.kcal}`}
                      className="btn btn-outline mt-3 w-full text-ivory"
                    >
                      {t.menu}
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed text-ivory/75">{t.noPlan}</p>
                    <a href={telegramUrl} className="btn btn-gold mt-4 w-full" rel="noopener">
                      {t.telegram}
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

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
                ≈ {formatSum(result.kcal)} <span className="font-sans text-sm text-ivory/70">{t.kcal}</span>
              </p>
              {plan && (
                <p className="label mt-0.5 truncate text-gold">
                  {plan.program.name} / {plan.variant.kcal}
                </p>
              )}
            </div>
            {plan ? (
              <Link
                href={`/${locale}/order?program=${plan.program.slug}&kcal=${plan.variant.kcal}`}
                className="btn btn-gold min-h-12 shrink-0 !px-5"
              >
                {t.orderShort}
              </Link>
            ) : (
              <a href={telegramUrl} className="btn btn-gold min-h-12 shrink-0 !px-5" rel="noopener">
                {t.telegram}
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
