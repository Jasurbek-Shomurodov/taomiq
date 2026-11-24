import type { ReactNode } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, htmlLang, type Locale } from "@/i18n/config";
import type { Tone } from "../../kit/Badge";
import { HelpButton } from "./HelpButton";

/*
 * Shared pieces of the Month and Year screens: how money and percentages are written, the tone of a result, and the
 * "?" beside a figure. No data access.
 */

export const DASH = "—";

export type HelpTopic = keyof AdminDictionary["finance"]["help"];

/** Whole UZS with a real minus sign: −1 250 000. */
export function signed(value: number): string {
  return `${value < 0 ? "−" : ""}${formatSum(Math.abs(value))}`;
}

/** "1 250 000 сум", "−80 000 сум". */
export function sumText(value: number, t: AdminDictionary): string {
  return `${signed(value)} ${t.common.currency}`;
}

/** A tile's figure: the amount, the currency smaller and muted. */
export function Money({ value, t, className = "" }: { value: number; t: AdminDictionary; className?: string }) {
  return (
    <span className={className}>
      {signed(value)}
      <span className="ml-1.5 text-base font-medium text-adm-muted">{t.common.currency}</span>
    </span>
  );
}

/** A percentage (12.5 means 12.5 %) in the panel's language: one decimal under 10, whole above; "—" for null. */
export function pct(value: number | null, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return new Intl.NumberFormat(htmlLang[locale], {
    style: "percent",
    maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0,
  }).format(value / 100);
}

/** A change in percent with its sign: "+12 %", "−3,5 %"; "—" for null. */
export function signedPct(value: number | null, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return new Intl.NumberFormat(htmlLang[locale], {
    style: "percent",
    maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0,
    signDisplay: "exceptZero",
  }).format(value / 100);
}

/** Above zero positive, below negative, zero (or unknown) plain. */
export function resultTone(value: number | null): Tone {
  if (value === null || value === 0) return "accent";
  return value > 0 ? "positive" : "negative";
}

/** The text colour for a result: green above zero, red below. */
export function resultClass(value: number | null): string {
  if (value === null || value === 0) return "";
  return value > 0 ? "text-adm-positive" : "text-adm-negative";
}

/** The "?" for a figure, in the admin's language. */
export function Help({ topic, locale }: { topic: HelpTopic; locale: Locale }) {
  const f = getAdminDictionary(locale).finance;
  const text = f.help[topic];
  return <HelpButton title={text.title} body={text.body} label={f.helpAria(text.title)} close={f.helpClose} />;
}

/** A caption with its "?" beside it. */
export function Labeled({ children, topic, locale }: { children: ReactNode; topic: HelpTopic; locale: Locale }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <Help topic={topic} locale={locale} />
    </span>
  );
}

/**
 * One figure in a grid of figures (a <dl>): caption with its "?", the value, and a caption line under it. `valueClass`
 * colours the value (a result, investor money).
 */
export function Indicator({
  topic,
  label,
  value,
  valueClass = "",
  hint,
  locale,
}: {
  topic: HelpTopic;
  label: ReactNode;
  value: ReactNode;
  valueClass?: string;
  hint?: ReactNode;
  locale: Locale;
}) {
  return (
    <div className="grid content-start gap-1">
      <dt className="adm-caption font-medium">
        <Labeled topic={topic} locale={locale}>
          {label}
        </Labeled>
      </dt>
      <dd className={`whitespace-nowrap text-xl font-semibold tabular-nums text-adm-text ${valueClass}`}>{value}</dd>
      {hint && <dd className="adm-caption flex flex-wrap items-center gap-2 tabular-nums">{hint}</dd>}
    </div>
  );
}
