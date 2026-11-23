"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { Dictionary } from "@/i18n";
import { formatSum, plural, type Locale } from "@/i18n/config";
import { pricePerDay, type Duration } from "@/lib/data/types";
import { submitOrder, type OrderState } from "@/lib/order/actions";
import {
  LIMITS,
  addDays,
  firstDeliveryDate,
  firstErrorField,
  fullPhone,
  isWeekend,
  phoneDigits,
  validateOrder,
  weekday,
  type FieldErrors,
  type OrderField,
} from "@/lib/order/rules";

export type OrderProgram = {
  slug: string;
  name: string;
  tagColor: string;
  tagline: string;
  variants: { id: string; kcal: number; meals: number; price: number }[];
};

type Props = {
  locale: Locale;
  t: Dictionary["order"];
  programs: OrderProgram[];
  durations: Duration[];
  windows: string[];
  cutoffHour: number;
  earliest: string;
  latest: string;
  initialProgram: string;
  initialVariant: string;
  source: Record<string, string>;
  telegramUrl: string;
  /** Pre-filled from the signed-in customer's profile; empty when signed out. Phone: the 9 digits after +998. */
  initialName?: string;
  initialPhone?: string;
};

/** How many start dates are offered as chips. */
const DATE_CHOICES = 21;

const fieldId = (field: OrderField) => `order-${field}`;

/** Host of an external page that sent the visitor here, if any. */
function externalReferrer(): string {
  try {
    const url = new URL(document.referrer);
    return url.host && url.host !== window.location.host ? url.host : "";
  } catch {
    return "";
  }
}

function focusField(field: OrderField | undefined) {
  if (!field) return;
  const element = document.getElementById(fieldId(field));
  element?.focus();
  element?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function OrderForm({
  locale,
  t,
  programs,
  durations,
  windows,
  cutoffHour,
  earliest,
  latest,
  initialProgram,
  initialVariant,
  source,
  telegramUrl,
  initialName = "",
  initialPhone = "",
}: Props) {
  const [state, formAction, pending] = useActionState<OrderState, FormData>(submitOrder, {});

  // Every field is controlled, so nothing typed is lost when the server returns an error.
  const [programSlug, setProgramSlug] = useState(initialProgram);
  const [variantId, setVariantId] = useState(initialVariant);
  const [days, setDays] = useState(
    () => (durations.find((d) => d.days === 7) ?? durations.find((d) => !d.is_trial) ?? durations[0]).days,
  );
  const [weekdaysOnly, setWeekdaysOnly] = useState(false);
  // Allowed start dates. The server sends a fresh range when the cutoff passed while the page was open.
  const [range, setRange] = useState({ earliest, latest });
  const [startDate, setStartDate] = useState(earliest);
  const [address, setAddress] = useState("");
  const [deliveryWindow, setDeliveryWindow] = useState(windows[1] ?? windows[0] ?? "");
  const [comment, setComment] = useState("");
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [exclusions, setExclusions] = useState("");
  const [consent, setConsent] = useState(false);

  // Client-side check results; null after a check that passed (then the server's answer is shown).
  const [clientErrors, setClientErrors] = useState<FieldErrors | null>(null);
  // Fields edited since the last submit: their old error is hidden.
  const [touched, setTouched] = useState<ReadonlySet<OrderField>>(new Set());
  const touch = (field: OrderField) =>
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));

  const alertRef = useRef<HTMLDivElement>(null);

  // New answer from the server with a fresh date range: move the selection to the first allowed date.
  // (Adjusting state while rendering, so the chips and summary update in the same render.)
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.startRange) {
      const next = state.startRange;
      setRange(next);
      setStartDate((current) => {
        const candidate = firstDeliveryDate(current < next.earliest ? next.earliest : current, weekdaysOnly);
        return candidate <= next.latest ? candidate : next.earliest;
      });
    }
  }

  const program = programs.find((p) => p.slug === programSlug) ?? programs[0];
  const variant = program.variants.find((v) => v.id === variantId) ?? program.variants[0];
  const duration = durations.find((d) => d.days === days) ?? durations[0];
  const perDay = pricePerDay(variant.price, duration.markup_pct);
  const total = perDay * duration.days;

  const dates: string[] = [];
  for (let i = 0; i < DATE_CHOICES; i++) {
    const date = addDays(range.earliest, i);
    if (date > range.latest) break;
    dates.push(date);
  }

  const errors: FieldErrors = pending ? {} : (clientErrors ?? state.fields ?? {});
  const errorText = (field: OrderField): string | null => {
    const code = errors[field];
    if (!code || touched.has(field)) return null;
    if (code === "too_long") return t.errors.tooLong;
    if (field === "start" && !clientErrors && state.startRange) return t.errors.startMoved;
    return field in t.errors ? t.errors[field as keyof typeof t.errors] : null;
  };
  const invalid = (field: OrderField) => Boolean(errorText(field));
  const describedBy = (field: OrderField, hint?: string) =>
    [hint, invalid(field) ? `${fieldId(field)}-error` : null].filter(Boolean).join(" ") || undefined;

  const generalError = pending ? null : state.demo ? t.general.demo : state.error ? t.general[state.error] : null;

  // Move focus to whatever the server answered.
  useEffect(() => {
    const field = state.fields ? firstErrorField(state.fields) : undefined;
    if (field) focusField(field);
    else if (state.error || state.demo) {
      alertRef.current?.focus();
      alertRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [state]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setTouched(new Set());

    const found = validateOrder(
      {
        variantId: variant.id,
        days: duration.days,
        weekdaysOnly,
        startDate,
        address,
        window: deliveryWindow,
        comment,
        name,
        phone: fullPhone(phone),
        exclusions,
        consent,
      },
      {
        variantIds: programs.flatMap((p) => p.variants.map((v) => v.id)),
        days: durations.map((d) => d.days),
        windows,
        ...range,
      },
    );
    if (Object.keys(found).length > 0) {
      setClientErrors(found);
      focusField(firstErrorField(found));
      return;
    }
    setClientErrors(null);

    if (!formData.get("ref")) {
      const referrer = externalReferrer();
      if (referrer) formData.set("ref", referrer);
    }
    startTransition(() => formAction(formData));
  }

  const dateLabel = (iso: string) => ({
    day: t.weekdayNames[weekday(iso)],
    date: `${Number(iso.slice(8, 10))} ${t.monthNames[Number(iso.slice(5, 7)) - 1]}`,
  });
  const daysWord = (n: number) => plural(n, t.dayForms);
  const money = (amount: number) => `${formatSum(amount)} ${t.currency}`;
  const start = dateLabel(startDate);

  const summaryLine = `${program.name} · ${variant.kcal} ${t.kcal} · ${duration.days} ${daysWord(duration.days)}`;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="container-page grid gap-8 pt-8 md:grid-cols-[minmax(0,1fr)_20rem] md:pb-16 md:pt-12 lg:gap-12"
    >
      <input type="hidden" name="locale" value={locale} />
      {Object.entries(source).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      {/* Honeypot: hidden from people and screen readers, filled only by bots. */}
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden>
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div className="grid min-w-0 gap-12">
        {/* 01 · Plan */}
        <Section number="01" title={t.sections.plan}>
          <fieldset
            id={fieldId("plan")}
            tabIndex={-1}
            aria-invalid={invalid("plan") || undefined}
            aria-describedby={describedBy("plan")}
            className="outline-none"
          >
            <legend className="label text-muted">{t.program}</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {programs.map((p) => (
                <Choice
                  key={p.slug}
                  name="program"
                  value={p.slug}
                  checked={p.slug === program.slug}
                  onChange={() => {
                    setProgramSlug(p.slug);
                    setVariantId(p.variants[0].id);
                    touch("plan");
                  }}
                >
                  <span className="block h-1 w-8 rounded-full" style={{ background: p.tagColor }} aria-hidden />
                  <span className="mt-3 block font-serif text-2xl leading-none">{p.name}</span>
                  <span className="mt-1.5 block text-sm opacity-75">{p.tagline}</span>
                </Choice>
              ))}
            </div>

            <p className="label mt-6 text-muted" id="order-level-label">
              {t.level}
            </p>
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="order-level-label">
              {program.variants.map((v) => (
                <Choice
                  key={v.id}
                  name="variant_id"
                  value={v.id}
                  checked={v.id === variant.id}
                  onChange={() => {
                    setVariantId(v.id);
                    touch("plan");
                  }}
                  compact
                >
                  <span className="block font-semibold tabular-nums">
                    {v.kcal} {t.kcal}
                  </span>
                  <span className="block text-xs opacity-70">
                    {v.meals} {t.meals}
                  </span>
                </Choice>
              ))}
            </div>
            <FieldError id={fieldId("plan")} text={errorText("plan")} />
          </fieldset>

          <fieldset
            id={fieldId("duration")}
            tabIndex={-1}
            aria-invalid={invalid("duration") || undefined}
            aria-describedby={describedBy("duration", "order-days-note")}
            className="outline-none"
          >
            <legend className="label text-muted">{t.duration}</legend>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {durations.map((d) => (
                <Choice
                  key={d.days}
                  name="days"
                  value={String(d.days)}
                  checked={d.days === duration.days}
                  onChange={() => {
                    setDays(d.days);
                    touch("duration");
                  }}
                >
                  {d.is_trial && <span className="label block text-gold">{t.trial}</span>}
                  <span className="block font-serif text-2xl leading-tight tabular-nums">
                    {d.days} <span className="font-sans text-base">{daysWord(d.days)}</span>
                  </span>
                  <span className="mt-1 block text-xs tabular-nums opacity-75">
                    {formatSum(pricePerDay(variant.price, d.markup_pct))} {t.perDay}
                  </span>
                </Choice>
              ))}
            </div>
            <p id="order-days-note" className="mt-2 text-sm text-muted">
              {t.daysNote}
            </p>
            <FieldError id={fieldId("duration")} text={errorText("duration")} />
          </fieldset>

          <fieldset>
            <legend className="label text-muted">{t.schedule}</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["everyday", false, t.everyDay, t.everyDayHint],
                  ["weekdays", true, t.weekdays, t.weekdaysHint],
                ] as const
              ).map(([value, isWeekdays, title, hint]) => (
                <Choice
                  key={value}
                  name="schedule"
                  value={value}
                  checked={weekdaysOnly === isWeekdays}
                  onChange={() => {
                    setWeekdaysOnly(isWeekdays);
                    // A weekend start date moves to the next Monday.
                    setStartDate((current) => {
                      const next = firstDeliveryDate(current, isWeekdays);
                      return next <= range.latest ? next : current;
                    });
                  }}
                >
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm opacity-70">{hint}</span>
                </Choice>
              ))}
            </div>
          </fieldset>

          <fieldset
            id={fieldId("start")}
            tabIndex={-1}
            aria-invalid={invalid("start") || undefined}
            aria-describedby={describedBy("start", "order-start-hint")}
            className="min-w-0 outline-none"
          >
            <legend className="label text-muted">{t.start}</legend>
            <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-2">
              {dates.map((iso) => {
                const label = dateLabel(iso);
                const disabled = weekdaysOnly && isWeekend(iso);
                return (
                  <Choice
                    key={iso}
                    name="start_date"
                    value={iso}
                    checked={iso === startDate}
                    disabled={disabled}
                    onChange={() => {
                      setStartDate(iso);
                      touch("start");
                    }}
                    compact
                    className="w-16 shrink-0 text-center"
                  >
                    <span className="block text-xs opacity-70">{label.day}</span>
                    <span className="block text-sm font-semibold tabular-nums">{label.date}</span>
                  </Choice>
                );
              })}
            </div>
            <p id="order-start-hint" className="mt-1 text-sm text-muted">
              {t.startHint.replace("{hour}", String(cutoffHour))}
            </p>
            <FieldError id={fieldId("start")} text={errorText("start")} />
          </fieldset>
        </Section>

        {/* 02 · Delivery */}
        <Section number="02" title={t.sections.delivery}>
          <div>
            <label htmlFor={fieldId("address")} className="label text-muted">
              {t.address}
            </label>
            <textarea
              id={fieldId("address")}
              name="address"
              required
              rows={3}
              maxLength={LIMITS.address.max}
              autoComplete="street-address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                touch("address");
              }}
              aria-invalid={invalid("address") || undefined}
              aria-describedby={describedBy("address", "order-address-hint")}
              className="field mt-2 resize-y"
            />
            <p id="order-address-hint" className="mt-1.5 text-sm text-muted">
              {t.addressHint}
            </p>
            <FieldError id={fieldId("address")} text={errorText("address")} />
          </div>

          <fieldset
            id={fieldId("window")}
            tabIndex={-1}
            aria-invalid={invalid("window") || undefined}
            aria-describedby={describedBy("window")}
            className="outline-none"
          >
            <legend className="label text-muted">{t.window}</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {windows.map((w) => (
                <Choice
                  key={w}
                  name="window"
                  value={w}
                  checked={w === deliveryWindow}
                  onChange={() => {
                    setDeliveryWindow(w);
                    touch("window");
                  }}
                  compact
                >
                  <span className="block font-semibold tabular-nums">{w}</span>
                </Choice>
              ))}
            </div>
            <FieldError id={fieldId("window")} text={errorText("window")} />
          </fieldset>

          <div>
            <label htmlFor={fieldId("comment")} className="label text-muted">
              {t.comment} <span className="normal-case tracking-normal">· {t.optional}</span>
            </label>
            <input
              id={fieldId("comment")}
              name="comment"
              maxLength={LIMITS.comment}
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                touch("comment");
              }}
              placeholder={t.commentPlaceholder}
              aria-invalid={invalid("comment") || undefined}
              aria-describedby={describedBy("comment")}
              className="field mt-2"
            />
            <FieldError id={fieldId("comment")} text={errorText("comment")} />
          </div>
        </Section>

        {/* 03 · Contact */}
        <Section number="03" title={t.sections.contact}>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor={fieldId("name")} className="label text-muted">
                {t.name}
              </label>
              <input
                id={fieldId("name")}
                name="name"
                required
                maxLength={LIMITS.name.max}
                autoComplete="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  touch("name");
                }}
                aria-invalid={invalid("name") || undefined}
                aria-describedby={describedBy("name")}
                className="field mt-2"
              />
              <FieldError id={fieldId("name")} text={errorText("name")} />
            </div>

            <div>
              <label htmlFor={fieldId("phone")} className="label text-muted">
                {t.phone}
              </label>
              <div
                className={`field mt-2 flex items-center gap-2 !p-0 focus-within:border-forest ${
                  invalid("phone") ? "!border-danger" : ""
                }`}
              >
                <span className="pl-3 font-semibold text-forest tabular-nums" aria-hidden>
                  +998
                </span>
                <input
                  id={fieldId("phone")}
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  required
                  value={phone}
                  onChange={(e) => {
                    setPhone(phoneDigits(e.target.value));
                    touch("phone");
                  }}
                  placeholder="901234567"
                  aria-invalid={invalid("phone") || undefined}
                  aria-describedby={describedBy("phone", "order-phone-hint")}
                  className="w-full min-w-0 rounded-r-[0.6rem] bg-transparent py-[0.6rem] pr-3 tabular-nums outline-none"
                />
              </div>
              <p id="order-phone-hint" className="mt-1.5 text-sm text-muted">
                {t.phoneHint}
              </p>
              <FieldError id={fieldId("phone")} text={errorText("phone")} />
            </div>
          </div>

          <div>
            <label htmlFor={fieldId("exclusions")} className="label text-muted">
              {t.exclusions} <span className="normal-case tracking-normal">· {t.optional}</span>
            </label>
            <input
              id={fieldId("exclusions")}
              name="exclusions"
              maxLength={LIMITS.exclusions}
              value={exclusions}
              onChange={(e) => {
                setExclusions(e.target.value);
                touch("exclusions");
              }}
              placeholder={t.exclusionsPlaceholder}
              aria-invalid={invalid("exclusions") || undefined}
              aria-describedby={describedBy("exclusions")}
              className="field mt-2"
            />
            <FieldError id={fieldId("exclusions")} text={errorText("exclusions")} />
          </div>

          <div>
            <div className="flex items-start gap-3">
              <input
                id={fieldId("consent")}
                name="consent"
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked);
                  touch("consent");
                }}
                aria-invalid={invalid("consent") || undefined}
                aria-describedby={describedBy("consent")}
                className="mt-0.5 h-5 w-5 shrink-0 accent-forest"
              />
              <label htmlFor={fieldId("consent")} className="text-sm leading-relaxed text-graphite">
                {t.consentBefore}
                <Link href={`/${locale}/privacy`} target="_blank" className="font-semibold text-forest underline">
                  {t.consentLink}
                </Link>
                {t.consentAfter}
              </label>
            </div>
            <FieldError id={fieldId("consent")} text={errorText("consent")} />
          </div>
        </Section>

        {generalError && (
          <div
            ref={alertRef}
            tabIndex={-1}
            role="alert"
            className="rounded-2xl border border-danger/30 bg-danger/10 p-5 outline-none"
          >
            <p className="text-graphite">{generalError}</p>
            <a href={telegramUrl} className="btn btn-forest mt-4 !px-5 !py-2.5 !text-sm" rel="noopener">
              {t.telegram}
            </a>
          </div>
        )}
      </div>

      {/* Summary: side card from md, sticky bottom bar on phones */}
      <aside className="hidden md:block">
        <div className="sticky top-24 rounded-3xl bg-forest p-6 text-ivory">
          <p className="label text-gold">{t.summary}</p>
          <p className="mt-3 font-serif text-3xl">{program.name}</p>
          <dl className="mt-4 grid gap-2 text-sm">
            <SummaryRow term={t.level} value={`${variant.kcal} ${t.kcal}`} />
            <SummaryRow
              term={t.duration}
              value={`${duration.days} ${daysWord(duration.days)}${weekdaysOnly ? ` · ${t.weekdaysShort}` : ""}`}
            />
            <SummaryRow term={t.start} value={`${start.day}, ${start.date}`} />
            <SummaryRow term={t.window} value={deliveryWindow} />
            <SummaryRow term={t.perDay} value={money(perDay)} />
          </dl>
          <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-ivory/15 pt-4">
            <span className="text-sm text-ivory/70">{t.total}</span>
            <span className="font-serif text-3xl tabular-nums">{money(total)}</span>
          </div>
          <button type="submit" disabled={pending} className="btn btn-gold mt-5 w-full disabled:opacity-60">
            {pending ? t.pending : t.submit}
          </button>
          <p className="mt-4 text-xs leading-relaxed text-ivory/60">{t.payNote}</p>
        </div>
      </aside>

      {/* Sticky (not fixed) so it stays with the form and never covers the footer. */}
      <div className="sticky bottom-0 z-30 -mx-5 border-t border-line bg-ivory/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted">{summaryLine}</p>
            <p className="font-serif text-xl text-forest tabular-nums">{money(total)}</p>
          </div>
          <button type="submit" disabled={pending} className="btn btn-forest shrink-0 !px-5 disabled:opacity-60">
            {pending ? t.pending : t.submit}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">{t.payNote}</p>
      </div>
    </form>
  );
}

function Section({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-8 border-t border-gold pt-5">
      <h2 className="flex items-baseline gap-3 font-serif text-3xl text-forest">
        <span className="text-gold">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A radio styled as a tappable card or chip. */
function Choice({
  name,
  value,
  checked,
  disabled,
  onChange,
  compact,
  className = "",
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`relative block ${disabled ? "cursor-not-allowed" : "cursor-pointer"} ${className}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="peer sr-only"
      />
      <span
        className={`block h-full border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold peer-disabled:opacity-35 ${
          compact ? "rounded-xl px-3.5 py-2.5" : "rounded-2xl p-4"
        } ${checked ? "border-forest bg-forest text-ivory" : "border-line bg-white text-forest hover:border-forest"}`}
      >
        {children}
      </span>
    </label>
  );
}

function SummaryRow({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ivory/60">{term}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

function FieldError({ id, text }: { id: string; text: string | null }) {
  if (!text) return null;
  return (
    <p id={`${id}-error`} className="mt-2 text-sm font-semibold text-danger">
      {text}
    </p>
  );
}
