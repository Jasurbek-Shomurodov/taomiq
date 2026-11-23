"use client";

import Link from "next/link";
import { useState } from "react";
import type { Dictionary } from "@/i18n";
import { formatSum, type Locale } from "@/i18n/config";
import { ACTIVITIES, GOALS, formatDecimal, proteinNeed, type Activity, type Goal } from "@/lib/calculator";
import { useCountUp } from "@/lib/use-count-up";
import type { CalculatorProgram } from "../Calculator";
import { NumberField, Option, ToolLayout, useNumberFields } from "../fields";

type Props = {
  locale: Locale;
  t: { calculator: Dictionary["calculator"]; tools: Dictionary["calcTools"] };
  programs: CalculatorProgram[];
  telegramUrl: string;
};

const FIELDS = ["weight"] as const;

/** Daily protein range from weight, activity and goal, and the program that fits that need. */
export function ProteinCalculator({ locale, t, programs, telegramUrl }: Props) {
  const c = t.calculator;
  const tool = t.tools.protein;
  const fields = useNumberFields(FIELDS);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);

  const weight = fields.parsed.weight;
  const result = weight !== null && activity && goal ? proteinNeed({ weight, activity, goal }) : null;
  const program = result ? programs.find((p) => p.slug === result.program) : undefined;
  const fromPrice = program ? Math.min(...program.variants.map((v) => v.fromPrice)) : null;

  const shownMin = useCountUp(result?.min ?? null);
  const shownMax = useCountUp(result?.max ?? null);
  const perKg = result
    ? tool.perKg.replace("{min}", formatDecimal(result.minPerKg)).replace("{max}", formatDecimal(result.maxPerKg))
    : "";

  const announcement = result
    ? [
        `${tool.resultLabel}: ${result.min}–${result.max} ${c.grams}.`,
        `${perKg}.`,
        program ? `${c.planLabel}: ${program.name}.` : c.noPlan,
      ].join(" ")
    : "";

  return (
    <ToolLayout
      label={tool.resultLabel}
      emptyText={t.tools.resultEmpty}
      announcement={announcement}
      form={
        <>
          <div className="max-w-[10rem]">
            <NumberField
              id="protein-weight"
              field="weight"
              label={c.weight}
              unit={c.weightUnit}
              value={fields.values.weight}
              invalid={fields.showError("weight")}
              rangeError={c.rangeError}
              onChange={(raw) => fields.set("weight", raw)}
              onBlur={() => fields.blur("weight")}
            />
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

          <fieldset>
            <legend className="label text-muted">{c.goal}</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {GOALS.map((value) => (
                <Option key={value} name="goal" value={value} checked={goal === value} onChange={() => setGoal(value)}>
                  <span className="block font-semibold">{c.goals[value].title}</span>
                </Option>
              ))}
            </div>
          </fieldset>
        </>
      }
      result={
        result && (
          <>
            <p className="mt-3 font-serif text-5xl tabular-nums" aria-hidden>
              {shownMin}–{shownMax} <span className="font-sans text-lg text-ivory/70">{c.grams}</span>
            </p>
            <p className="mt-2 text-sm text-ivory/70" aria-hidden>
              {perKg}
            </p>

            <div className="mt-6 border-t border-ivory/15 pt-5">
              {program && fromPrice !== null ? (
                <>
                  <p className="label text-gold">{c.planLabel}</p>
                  <span className="mt-4 block h-1 w-8 rounded-full" style={{ background: program.tagColor }} aria-hidden />
                  <p className="mt-3 font-serif text-3xl leading-tight">{program.name}</p>
                  <p className="mt-2 text-sm text-ivory/70">
                    {c.from} <span className="font-semibold text-ivory">{formatSum(fromPrice)}</span> {c.perDay}
                  </p>
                  {result.program === "protein" && (
                    <p className="mt-3 text-xs leading-relaxed text-ivory/60">{tool.high}</p>
                  )}
                  <Link href={`/${locale}/order?program=${program.slug}`} className="btn btn-gold mt-5 w-full">
                    {c.order}
                  </Link>
                  <Link href={`/${locale}/programs/${program.slug}`} className="btn btn-outline mt-3 w-full text-ivory">
                    {t.tools.programLink}
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

            <div className="mt-6 border-t border-ivory/15 pt-5">
              <p className="text-sm leading-relaxed text-ivory/75">{t.tools.caloriesHint}</p>
              <Link
                href={`/${locale}/calculator`}
                className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-ivory underline decoration-gold underline-offset-4"
              >
                {t.tools.caloriesLink} <span aria-hidden>&nbsp;→</span>
              </Link>
            </div>
          </>
        )
      }
    />
  );
}
