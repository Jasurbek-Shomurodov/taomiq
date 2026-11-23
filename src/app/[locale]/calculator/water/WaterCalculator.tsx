"use client";

import { useState } from "react";
import type { Dictionary } from "@/i18n";
import { plural, type Locale } from "@/i18n/config";
import { ACTIVITIES, formatDecimal, waterNeed, type Activity } from "@/lib/calculator";
import { useCountUp } from "@/lib/use-count-up";
import { NextSteps, NumberField, Option, ToolLayout, useNumberFields } from "../fields";

type Props = {
  locale: Locale;
  t: { calculator: Dictionary["calculator"]; tools: Dictionary["calcTools"] };
};

const FIELDS = ["weight"] as const;

/** Daily fluid range in litres and glasses from weight and activity. */
export function WaterCalculator({ locale, t }: Props) {
  const c = t.calculator;
  const tool = t.tools.water;
  const fields = useNumberFields(FIELDS);
  const [activity, setActivity] = useState<Activity | null>(null);

  const weight = fields.parsed.weight;
  const result = weight !== null && activity ? waterNeed({ weight, activity }) : null;
  // Counts in tenths of a litre, so the figures keep their decimal while they move.
  const shownMin = useCountUp(result ? Math.round(result.min * 10) : null) / 10;
  const shownMax = useCountUp(result ? Math.round(result.max * 10) : null) / 10;
  const glasses = result
    ? tool.glasses
        .replace("{min}", String(result.glassesMin))
        .replace("{max}", String(result.glassesMax))
        .replace("{glasses}", plural(result.glassesMax, tool.glassForms))
    : "";

  const announcement = result
    ? `${tool.resultLabel}: ${formatDecimal(result.min)}–${formatDecimal(result.max)} ${tool.unit}. ${glasses}.`
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
              id="water-weight"
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
        </>
      }
      result={
        result && (
          <>
            <p className="mt-3 font-serif text-5xl tabular-nums" aria-hidden>
              {formatDecimal(shownMin)}–{formatDecimal(shownMax)}{" "}
              <span className="font-sans text-lg text-ivory/70">{tool.unit}</span>
            </p>
            <p className="mt-2 text-sm text-ivory/70" aria-hidden>
              {glasses}
            </p>
            <NextSteps locale={locale} tools={t.tools} />
          </>
        )
      }
    />
  );
}
