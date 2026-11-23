"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Dictionary } from "@/i18n";
import { formatSum, type Locale } from "@/i18n/config";
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

  const labels: Record<NumericField, { label: string; unit: string }> = {
    age: { label: t.age, unit: t.ageUnit },
    height: { label: t.height, unit: t.heightUnit },
    weight: { label: t.weight, unit: t.weightUnit },
  };

  return (
    <section className="container-page grid gap-10 py-10 md:grid-cols-[minmax(0,1fr)_22rem] md:py-14 lg:gap-14">
      <form className="grid min-w-0 gap-10" onSubmit={(e) => e.preventDefault()} noValidate>
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
        <div className="rounded-3xl bg-forest p-6 text-ivory md:sticky md:top-24" aria-live="polite">
          {!result ? (
            <>
              <p className="label text-gold">{t.resultLabel}</p>
              <p className="mt-4 leading-relaxed text-ivory/75">{t.resultEmpty}</p>
            </>
          ) : (
            <>
              <p className="label text-gold">{t.resultLabel}</p>
              <p className="mt-3 font-serif text-5xl tabular-nums">
                {formatSum(result.kcal)} <span className="font-sans text-lg text-ivory/70">{t.kcal}</span>
              </p>
              <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-ivory/15 pt-4">
                {(
                  [
                    [t.protein, result.protein],
                    [t.fat, result.fat],
                    [t.carbs, result.carbs],
                  ] as const
                ).map(([term, grams]) => (
                  <div key={term}>
                    <dt className="text-xs text-ivory/60">{term}</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">
                      {grams} <span className="text-sm font-normal text-ivory/70">{t.grams}</span>
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
            </>
          )}
        </div>
      </aside>
    </section>
  );
}

/** A radio styled as a tappable card or chip (same look as the order form). */
function Option({
  name,
  value,
  checked,
  onChange,
  compact,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="relative block cursor-pointer">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        className={`block h-full border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold ${
          compact ? "rounded-xl px-3.5 py-2.5" : "rounded-2xl p-4"
        } ${checked ? "border-forest bg-forest text-ivory" : "border-line bg-white text-forest hover:border-forest"}`}
      >
        {children}
      </span>
    </label>
  );
}
