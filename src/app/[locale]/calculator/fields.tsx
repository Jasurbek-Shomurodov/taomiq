"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { RANGES, parseField, type NumericField } from "@/lib/calculator";

/** A radio styled as a tappable card or chip (same look as the order form). The calculator uses it. */
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
 * Typed numbers for the quiz: the raw text per field, the parsed value (null when empty or out
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

/** Pressing and holding − / + repeats the step after this delay, then every REPEAT_MS. */
const HOLD_DELAY_MS = 400;
const REPEAT_MS = 70;

/**
 * A slider with its value shown (serif) and − / + buttons beside the track, each a 44 px target. A native
 * range input (globals.css, .range), so the keyboard, screen readers (aria-valuetext with the unit) and
 * touch all work as usual. Holding − or + keeps stepping.
 */
export function SliderField({
  id,
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  decreaseLabel,
  increaseLabel,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Accessible names of the − and + buttons ("Less: weight"). */
  decreaseLabel: string;
  increaseLabel: string;
  /** A line under the slider, linked to it with aria-describedby (the goal weight's lower stop). */
  hint?: ReactNode;
  onChange: (value: number) => void;
}) {
  const clampValue = (next: number) => Math.min(Math.max(next, min), max);
  // The latest value and handler, for the hold-to-repeat timer.
  const latest = useRef({ value, onChange, clampValue });
  useEffect(() => {
    latest.current = { value, onChange, clampValue };
  });
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const nudge = (delta: number) => {
    const { value: current, onChange: change, clampValue: limit } = latest.current;
    const next = limit(current + delta);
    if (next !== current) change(next);
    return next !== current;
  };
  const startHold = (delta: number) => {
    stop();
    if (!nudge(delta)) return;
    const repeat = () => {
      if (nudge(delta)) timer.current = window.setTimeout(repeat, REPEAT_MS);
      else timer.current = null;
    };
    timer.current = window.setTimeout(repeat, HOLD_DELAY_MS);
  };

  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const hintId = hint ? `${id}-hint` : undefined;

  const stepButton = (delta: number, name: string, sign: string) => {
    const disabled = delta < 0 ? value <= min : value >= max;
    return (
      <button
        type="button"
        aria-label={name}
        disabled={disabled}
        // Pointer: step on press and repeat while held. Keyboard (Enter / Space): one step per click.
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          startHold(delta);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          if (e.detail === 0) nudge(delta);
        }}
        className="press flex size-11 shrink-0 select-none items-center justify-center rounded-full border border-line bg-white text-xl leading-none text-forest hover:border-forest disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
      >
        <span aria-hidden>{sign}</span>
      </button>
    );
  };

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="label text-muted">
          {label}
        </label>
        <p className="font-serif text-2xl leading-none text-forest tabular-nums" aria-hidden>
          {value} <span className="font-sans text-sm text-muted">{unit}</span>
        </p>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {stepButton(-step, decreaseLabel, "−")}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clampValue(Number(e.target.value)))}
          aria-valuetext={`${value} ${unit}`}
          aria-describedby={hintId}
          className="range min-w-0 flex-1"
          style={{ "--fill": `${fill.toFixed(2)}%` } as CSSProperties}
        />
        {stepButton(step, increaseLabel, "+")}
      </div>
      {hint && (
        <p id={hintId} className="mt-1 text-sm leading-relaxed text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
