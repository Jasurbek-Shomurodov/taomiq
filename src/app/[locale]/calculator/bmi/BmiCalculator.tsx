"use client";

import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { BMI_CATEGORIES, bodyMassIndex, formatDecimal, type BmiCategory } from "@/lib/calculator";
import { useCountUp } from "@/lib/use-count-up";
import { NextSteps, NumberField, ToolLayout, useNumberFields } from "../fields";

type Props = {
  locale: Locale;
  t: { calculator: Dictionary["calculator"]; tools: Dictionary["calcTools"] };
};

const FIELDS = ["height", "weight"] as const;

/** The scale drawn under the result: BMI 15 to 40, split at the WHO cut-offs. */
const SCALE_MIN = 15;
const SCALE_MAX = 40;
const BANDS: Record<BmiCategory, { from: number; to: number; color: string }> = {
  under: { from: SCALE_MIN, to: 18.5, color: "color-mix(in srgb, var(--color-ivory) 40%, transparent)" },
  normal: { from: 18.5, to: 25, color: "var(--color-sage)" },
  over: { from: 25, to: 30, color: "var(--color-gold)" },
  obese: { from: 30, to: SCALE_MAX, color: "#B5714F" /* the PROTEIN tag colour: a warm red that is not an alarm */ },
};
const position = (bmi: number) =>
  `${(Math.min(Math.max((bmi - SCALE_MIN) / (SCALE_MAX - SCALE_MIN), 0), 1) * 100).toFixed(2)}%`;

/** BMI from height and weight, its WHO class and the normal weight range for that height. */
export function BmiCalculator({ locale, t }: Props) {
  const c = t.calculator;
  const tool = t.tools.bmi;
  const fields = useNumberFields(FIELDS);

  const { height, weight } = fields.parsed;
  const result = height !== null && weight !== null ? bodyMassIndex({ height, weight }) : null;
  // Counts in tenths, so the figure keeps its decimal while it moves.
  const shown = useCountUp(result ? Math.round(result.bmi * 10) : null) / 10;
  const normalRange = result
    ? tool.normalRange.replace("{min}", String(result.normalMin)).replace("{max}", String(result.normalMax))
    : "";

  const announcement = result
    ? `${tool.resultLabel}: ${formatDecimal(result.bmi)} ${tool.unit}, ${tool.categories[result.category]}. ${normalRange}.`
    : "";

  return (
    <ToolLayout
      label={tool.resultLabel}
      emptyText={t.tools.resultEmpty}
      announcement={announcement}
      form={
        <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
          {FIELDS.map((field) => (
            <NumberField
              key={field}
              id={`bmi-${field}`}
              field={field}
              label={field === "height" ? c.height : c.weight}
              unit={field === "height" ? c.heightUnit : c.weightUnit}
              value={fields.values[field]}
              invalid={fields.showError(field)}
              rangeError={c.rangeError}
              onChange={(raw) => fields.set(field, raw)}
              onBlur={() => fields.blur(field)}
            />
          ))}
        </div>
      }
      result={
        result && (
          <>
            <p className="mt-3 font-serif text-5xl tabular-nums" aria-hidden>
              {formatDecimal(shown)} <span className="font-sans text-lg text-ivory/70">{tool.unit}</span>
            </p>
            <p className="mt-2 text-lg font-semibold text-gold" aria-hidden>
              {tool.categories[result.category]}
            </p>

            {/* WHO scale with the visitor's place on it */}
            <div className="mt-5" aria-hidden title={tool.scaleLabel}>
              <div className="relative h-2.5 overflow-hidden rounded-full">
                <div className="flex h-full">
                  {BMI_CATEGORIES.map((category) => {
                    const band = BANDS[category];
                    return (
                      <span
                        key={category}
                        className="h-full"
                        style={{
                          width: `${((band.to - band.from) / (SCALE_MAX - SCALE_MIN)) * 100}%`,
                          background: band.color,
                          opacity: category === result.category ? 1 : 0.45,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="relative mt-1 h-4">
                <span
                  className="absolute top-0 h-3 w-0.5 -translate-x-1/2 rounded-full bg-ivory transition-[left] duration-(--duration-base) ease-out-calm"
                  style={{ left: position(result.bmi) }}
                />
              </div>
              <div className="relative h-4 text-[0.7rem] text-ivory/60 tabular-nums">
                {[18.5, 25, 30].map((cut) => (
                  <span key={cut} className="absolute -translate-x-1/2" style={{ left: position(cut) }}>
                    {formatDecimal(cut, cut % 1 === 0 ? 0 : 1)}
                  </span>
                ))}
              </div>
            </div>

            <p className="mt-5 text-sm leading-relaxed text-ivory/80">{normalRange}</p>

            <NextSteps locale={locale} tools={t.tools} />
          </>
        )
      }
    />
  );
}
