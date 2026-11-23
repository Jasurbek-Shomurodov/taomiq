"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { RANGES, parseField, type NumericField } from "@/lib/calculator";

/** A radio styled as a tappable card or chip (same look as the order form). Every calculator uses it. */
export function Option({
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

/**
 * The small calculators' layout: the form, then (from md beside it, sticky) the forest result card. Screen
 * readers hear the final result from the live region; the counting figures are hidden from them.
 */
export function ToolLayout({
  form,
  label,
  emptyText,
  announcement,
  result,
}: {
  form: ReactNode;
  /** The card's gold label ("Protein per day"). */
  label: string;
  emptyText: string;
  /** Plain-text result for the live region; empty while there is none. */
  announcement: string;
  /** The result, or null while fields are missing. */
  result: ReactNode | null;
}) {
  return (
    <section className="container-page grid gap-10 py-10 md:grid-cols-[minmax(0,1fr)_22rem] md:py-14 lg:gap-14">
      <form className="grid min-w-0 content-start gap-10" onSubmit={(e) => e.preventDefault()} noValidate>
        {form}
      </form>
      <aside>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
        <div className="rounded-3xl bg-forest p-6 text-ivory md:sticky md:top-24">
          <p className="label text-gold">{label}</p>
          {result === null ? (
            <p className="mt-4 leading-relaxed text-ivory/75">{emptyText}</p>
          ) : (
            <div className="motion-safe:animate-rise">{result}</div>
          )}
        </div>
      </aside>
    </section>
  );
}

/**
 * Typed numbers for the small calculators: the raw text per field, the parsed value (null when empty or out
 * of range, see parseField) and whether to show the range error, which waits until the visitor leaves the field.
 */
export function useNumberFields<F extends NumericField>(fields: readonly F[]) {
  const [values, setValues] = useState<Record<F, string>>(
    () => Object.fromEntries(fields.map((f) => [f, ""])) as Record<F, string>,
  );
  const [blurred, setBlurred] = useState<ReadonlySet<F>>(new Set());
  const parsed = Object.fromEntries(fields.map((f) => [f, parseField(f, values[f])])) as Record<F, number | null>;

  return {
    values,
    parsed,
    showError: (field: F) => blurred.has(field) && values[field].trim() !== "" && parsed[field] === null,
    set: (field: F, raw: string) =>
      setValues((prev) => ({ ...prev, [field]: raw.replace(/\D/g, "").slice(0, 3) })),
    blur: (field: F) => setBlurred((prev) => (prev.has(field) ? prev : new Set(prev).add(field))),
  };
}

/** A number input with its unit inside the box: 16 px text (no zoom on iOS), digits only, range error below. */
export function NumberField({
  id,
  field,
  label,
  unit,
  value,
  invalid,
  rangeError,
  onChange,
  onBlur,
}: {
  id: string;
  field: NumericField;
  label: string;
  unit: string;
  value: string;
  invalid: boolean;
  /** "Enter a number from {min} to {max}." */
  rangeError: string;
  onChange: (raw: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label text-muted">
        {label}
      </label>
      <div
        className={`field mt-2 flex items-center gap-1 !p-0 focus-within:border-forest ${invalid ? "!border-danger" : ""}`}
      >
        <input
          id={id}
          name={field}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className="w-full min-w-0 rounded-l-[0.6rem] bg-transparent py-[0.6rem] pl-3 font-semibold text-forest tabular-nums outline-none"
        />
        <span className="pr-3 text-sm text-muted" aria-hidden>
          {unit}
        </span>
      </div>
      {invalid && (
        <p id={`${id}-error`} className="mt-2 text-sm font-semibold text-danger">
          {rangeError.replace("{min}", String(RANGES[field].min)).replace("{max}", String(RANGES[field].max))}
        </p>
      )}
    </div>
  );
}

/** BMI and water: the next step is the calorie calculator (a ration level), then the programs. */
export function NextSteps({ locale, tools }: { locale: Locale; tools: Dictionary["calcTools"] }) {
  return (
    <div className="mt-6 border-t border-ivory/15 pt-5">
      <p className="label text-gold">{tools.nextTitle}</p>
      <p className="mt-3 text-sm leading-relaxed text-ivory/75">{tools.caloriesHint}</p>
      <Link href={`/${locale}/calculator`} className="btn btn-gold mt-5 w-full">
        {tools.caloriesLink}
      </Link>
      <Link href={`/${locale}#programs`} className="btn btn-outline mt-3 w-full text-ivory">
        {tools.programsLink}
      </Link>
    </div>
  );
}
