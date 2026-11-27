"use client";

import Link from "next/link";
import {
  ViewTransition,
  addTransitionType,
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Turnstile } from "@/components/Turnstile";
import type { Dictionary } from "@/i18n";
import { formatSum, plural, type Locale } from "@/i18n/config";
import { track } from "@/lib/analytics/client";
import { pricePerDay, type Duration } from "@/lib/data/types";
import { submitOrder, type OrderState } from "@/lib/order/actions";
import {
  FIELD_STEP,
  LIMITS,
  ORDER_FIELDS,
  ORDER_STEPS,
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
  type OrderStep,
} from "@/lib/order/rules";
import { StepProgress } from "./StepProgress";

export type OrderProgram = {
  slug: string;
  name: string;
  tagColor: string;
  tagline: string;
  variants: { id: string; kcal: number; meals: number; price: number }[];
};

/**
 * Fields filled in on the server for a signed-in customer: their saved delivery details (migration 0030), or an earlier
 * order of theirs (?repeat=). Undefined fields keep the form's own defaults.
 */
export type OrderPrefill = {
  days?: number;
  weekdaysOnly?: boolean;
  address?: string;
  window?: string;
  comment?: string;
  exclusions?: string;
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
  /** Turnstile site key, "" when the bot check is off (src/lib/turnstile/config.ts). */
  turnstileKey: string;
  /** "The trial costs the same per day as a week", under the durations; "" when that is not so (trialAtWeekPrice). */
  trialNote?: string;
  prefill?: OrderPrefill;
  /** Signed in: the "Save for next time" checkbox is shown (unticked). */
  canSaveDelivery?: boolean;
  /** One line above the form: where a repeated order's fields came from, or why one could not be used. */
  notice?: string;
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

/**
 * A random v4 UUID: the order's request id. crypto.randomUUID needs a secure context (https or localhost); a phone
 * testing the dev server over the LAN falls back to getRandomValues.
 */
function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function focusField(field: OrderField | undefined) {
  if (!field) return;
  const element = document.getElementById(fieldId(field));
  element?.focus();
  element?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (element) nudge(element);
}

/** One 4 px sideways nudge (160 ms) on an invalid field: the text box, the phone frame or the consent row. */
function nudge(element: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target =
    element instanceof HTMLInputElement && element.type === "checkbox"
      ? element.parentElement
      : (element.closest<HTMLElement>(".field") ?? element);
  target?.animate([{ transform: "none" }, { transform: "translateX(4px)" }, { transform: "none" }], {
    duration: 160,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });
}

/**
 * Phones (below md) show one section at a time. The other sections stay rendered, only hidden with
 * display: none (`max-md:hidden`), so their inputs keep their values and are still part of the FormData the
 * submit sends; `noValidate` means the browser never tries to validate or focus a hidden input. Read only in
 * event handlers and effects, never during render: server and client both render step 1 first.
 */
const isStepped = () => !window.matchMedia("(min-width: 48rem)").matches;

/*
 * The step lives in component state only, never in the URL or the browser history: the page's Back button goes
 * to the previous step, the browser's Back leaves the page (the page is kept, so Forward returns to the same step
 * with every answer). History entries were tried and dropped: kept pages (<Activity>), reloads and Next's own
 * history writes made the browser's Back on this form sometimes a dead tap.
 */
const LAST_STEP = (ORDER_STEPS - 1) as OrderStep;
const stepHeadingId = (step: OrderStep) => `order-step-${step + 1}`;
/** After a step change the bar's button ignores taps this long, so a quick second tap never lands on the next one. */
const SETTLE_MS = 400;

/** The errors of one step's fields, or of every other step's. */
function errorsOf(errors: FieldErrors, step: OrderStep, keep: boolean): FieldErrors {
  const result: FieldErrors = {};
  for (const field of ORDER_FIELDS) {
    if (errors[field] && (FIELD_STEP[field] === step) === keep) result[field] = errors[field];
  }
  return result;
}

/**
 * After an order went through, the server redirects to the success page while this page is kept (hidden) for
 * back/forward. The kept form would still hold the name, phone, address and consent, one tap from a second order,
 * so the form body is replaced by a fresh one (new key): Back from the success page shows an empty form at step 1,
 * with the URL's program and level chosen again.
 */
export function OrderForm(props: Props) {
  const [round, setRound] = useState(0);
  // Analytics: the step last sent as order_step_viewed. Kept here, across rounds: the fresh form after an order is
  // only seen through Back, which is a page shown again, not a step viewed, so its step 1 counts as already sent.
  const viewedStepRef = useRef<OrderStep | null>(null);
  const placed = useCallback(() => {
    viewedStepRef.current = 0;
    setRound((n) => n + 1);
  }, []);
  // The fresh form after an order starts empty, as before: no prefill and no repeat line.
  const fresh = round === 0 ? {} : { prefill: undefined, notice: "" };
  return <OrderFormBody key={round} {...props} {...fresh} onPlaced={placed} viewedStepRef={viewedStepRef} />;
}

function OrderFormBody({
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
  turnstileKey,
  trialNote = "",
  prefill,
  canSaveDelivery = false,
  notice = "",
  onPlaced,
  viewedStepRef,
}: Props & { onPlaced: () => void; viewedStepRef: RefObject<OrderStep | null> }) {
  const [state, formAction, pending] = useActionState<OrderState, FormData>(submitOrder, {});

  // Every field is controlled, so nothing typed is lost when the server returns an error.
  const [programSlug, setProgramSlug] = useState(initialProgram);
  const [variantId, setVariantId] = useState(initialVariant);
  const [days, setDays] = useState(
    () =>
      (
        durations.find((d) => d.days === prefill?.days) ??
        durations.find((d) => d.days === 7) ??
        durations.find((d) => !d.is_trial) ??
        durations[0]
      ).days,
  );
  const [weekdaysOnly, setWeekdaysOnly] = useState(prefill?.weekdaysOnly ?? false);
  // Allowed start dates. The server sends a fresh range when the cutoff passed while the page was open.
  const [range, setRange] = useState({ earliest, latest });
  // The earliest allowed date; a repeated weekdays-only order moves a weekend to the next Monday.
  const [startDate, setStartDate] = useState(() => {
    const first = firstDeliveryDate(earliest, prefill?.weekdaysOnly ?? false);
    return first <= latest ? first : earliest;
  });
  const defaultWindow = windows[1] ?? windows[0] ?? "";
  const [address, setAddress] = useState(prefill?.address ?? "");
  const [deliveryWindow, setDeliveryWindow] = useState(
    prefill?.window && windows.includes(prefill.window) ? prefill.window : defaultWindow,
  );
  const [comment, setComment] = useState(prefill?.comment ?? "");
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [exclusions, setExclusions] = useState(prefill?.exclusions ?? "");
  const [consent, setConsent] = useState(false);
  // "Save for next time" (signed in only): off until the customer ticks it (consent to keep the address).
  const [saveDelivery, setSaveDelivery] = useState(false);
  // The address and note were filled in for the customer: "Clear" empties them while there is something to clear.
  const deliveryPrefilled = Boolean(prefill?.address || prefill?.comment);

  // One order per tap (migration 0027): one request id for this form round, made at the first send and sent again on
  // every retry, so a second tap after a lost answer gets the saved order's number instead of a second order. A placed
  // order starts a new round (a new body, see OrderForm), and with it a new id.
  const requestId = useRef("");

  // Set when a valid order is sent; cleared by any answer from the server. If the page is hidden while it is still
  // set, the action redirected to the success page: the order is placed, so the kept form starts over.
  const sent = useRef(false);
  /**
   * Any change to the order. After a send that got no answer yet, the next send is a different order (the customer
   * corrected something), so it gets a new request id: a retry with the old id would return the first order and
   * silently drop the correction.
   */
  const changed = () => {
    if (sent.current) requestId.current = "";
  };

  // Client-side check results; null after a check that passed (then the server's answer is shown).
  const [clientErrors, setClientErrors] = useState<FieldErrors | null>(null);
  // Fields edited since the last submit: their old error is hidden.
  const [touched, setTouched] = useState<ReadonlySet<OrderField>>(new Set());
  const touch = (field: OrderField) => {
    changed();
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  };

  const alertRef = useRef<HTMLDivElement>(null);

  // Phones: which section is on screen. Every width renders 0 first; from md all sections show and this is unused.
  const [step, setStep] = useState<OrderStep>(0);
  const columnRef = useRef<HTMLDivElement>(null);
  // True for SETTLE_MS after a step change: the bar's button is disabled, Next and submit do nothing.
  const [settling, setSettling] = useState(false);
  const settleTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);
  // Set by a step change (never on arrival), so focus moves only after one.
  const moved = useRef(false);
  // The invalid field to focus once its step is on screen, instead of the step heading.
  const focusAfter = useRef<OrderField | null>(null);

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

  /**
   * Puts another step on screen: back to the top of the form, then the new section fades in and rises 12 px. The
   * bar's button is disabled for SETTLE_MS, so a fast second tap on Next never lands on the next step's button.
   */
  function show(next: OrderStep, field?: OrderField) {
    const column = columnRef.current;
    if (column && column.getBoundingClientRect().top < 64) column.scrollIntoView({ block: "start", behavior: "instant" });
    focusAfter.current = field ?? null;
    moved.current = true;
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => setSettling(false), SETTLE_MS);
    // One commit: the new step and the resting button appear together. Until then the old button is still the
    // same element, and a second tap on it only asks for the same step again.
    startTransition(() => {
      addTransitionType("order-step");
      setSettling(true);
      setStep(next);
    });
  }

  /** Focuses an invalid field; on a phone, first brings up the step that holds it. */
  function reveal(field: OrderField | undefined) {
    if (!field) return;
    if (FIELD_STEP[field] === step || !isStepped()) focusField(field);
    else show(FIELD_STEP[field], field);
  }

  // Analytics: each step put on screen on a phone (1, 2, 3, and again after the form's Back), or the single page once
  // from md (the step never changes there). Effects run again when Next.js shows this kept page again (browser
  // Back); the step has not changed then, so nothing is sent.
  useEffect(() => {
    if (viewedStepRef.current === step) return;
    viewedStepRef.current = step;
    const stepped = isStepped();
    if (!stepped && step !== 0) return;
    track("order_step_viewed", { step: (step + 1) as 1 | 2 | 3, layout: stepped ? "steps" : "single", locale });
  }, [step, locale, viewedStepRef]);

  // After a step change, keyboard and screen-reader users land on the new step's heading ("Step 2 of 3: Delivery"),
  // or on the invalid field that caused the change.
  useEffect(() => {
    if (!moved.current) return;
    const field = focusAfter.current;
    focusAfter.current = null;
    if (field) focusField(field);
    else document.getElementById(stepHeadingId(step))?.focus({ preventScroll: true });
  }, [step]);

  const onHide = useEffectEvent(() => {
    if (sent.current) onPlaced();
  });
  useLayoutEffect(() => () => onHide(), []);

  // Analytics: the answer last sent as order_failed. The effect below runs again when the kept page is shown again;
  // each answer is sent once.
  const trackedAnswer = useRef<OrderState | null>(null);

  // Move focus to whatever the server answered (on a phone, on the step that holds the first invalid field).
  const onAnswer = useEffectEvent((answer: OrderState) => {
    sent.current = false;
    if ((answer.fields || answer.error) && trackedAnswer.current !== answer) {
      trackedAnswer.current = answer;
      const reason = answer.fields ? "field-error" : answer.error === "captcha" ? "turnstile" : "server";
      track("order_failed", { reason, locale });
    }
    const field = answer.fields ? firstErrorField(answer.fields) : undefined;
    if (field) reveal(field);
    else if (answer.error || answer.demo) {
      alertRef.current?.focus();
      alertRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
  useEffect(() => {
    onAnswer(state);
  }, [state]);

  /** "Clear": the filled-in address, time and courier note give way to an empty address field (focused). */
  function clearDelivery() {
    changed();
    setAddress("");
    setComment("");
    setDeliveryWindow(defaultWindow);
    setTouched((prev) => new Set([...prev, "address", "window", "comment"]));
    document.getElementById(fieldId("address"))?.focus();
  }

  function check(): FieldErrors {
    return validateOrder(
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
  }

  /**
   * Phones' Next (its own type="button", never a submit): checks only this step's fields (the same validateOrder
   * result, filtered by FIELD_STEP). With an error it stays, shows it and focuses the field; otherwise the next step
   * comes up. Errors already shown for the other steps (from the server or an earlier submit) are kept.
   */
  function next() {
    if (settling || pending || step >= LAST_STEP) return;
    const shown = clientErrors ?? state.fields ?? {};
    const found = errorsOf(check(), step, true);
    const others = errorsOf(shown, step, false);
    const field = firstErrorField(found);
    if (field) {
      setTouched((prev) => new Set([...prev].filter((f) => FIELD_STEP[f] !== step)));
      setClientErrors({ ...others, ...found });
      focusField(field);
      return;
    }
    if (clientErrors || state.fields) setClientErrors(others);
    show((step + 1) as OrderStep);
  }

  /** Phones' Back button: the previous step, every answer kept. */
  function back() {
    if (step > 0 && !settling) show((step - 1) as OrderStep);
  }

  /** Phones, steps 1–2: Enter in a field goes to the next step instead of sending the form. */
  function onKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type === "checkbox") return;
    if (step >= LAST_STEP || !isStepped()) return;
    event.preventDefault();
    next();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || settling) return;
    // Phones send only from step 3 (its own Order button, or Enter there). Steps 1–2 have no submit button on screen.
    if (step < LAST_STEP && isStepped()) return;
    const formData = new FormData(event.currentTarget);
    setTouched(new Set());

    const found = check();
    if (Object.keys(found).length > 0) {
      setClientErrors(found);
      reveal(firstErrorField(found));
      return;
    }
    setClientErrors(null);

    if (!formData.get("ref")) {
      const referrer = externalReferrer();
      if (referrer) formData.set("ref", referrer);
    }
    requestId.current ||= newRequestId();
    formData.set("request_id", requestId.current);
    sent.current = true;
    // Describes the order only: never the name, phone, address or comment.
    track("order_submitted", {
      program: program.slug,
      kcal: variant.kcal,
      days: duration.days,
      weekdays_only: weekdaysOnly,
      locale,
    });
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
  const stepLabel = (s: OrderStep) => t.step.replace("{n}", String(s + 1)).replace("{total}", String(ORDER_STEPS));
  // "Talk to a person" on every step (spec §4): under each step heading on phones, once under the summary from md.
  const help = <HelpLink text={t.help} link={t.helpLink} href={telegramUrl} />;

  return (
    // method="post": a tap before the script has loaded must never send the fields as a GET query string (name and
    // phone in the address bar, logs and referrers). After hydration onSubmit always prevents the native submit.
    <form
      method="post"
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
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

      {/* scroll-mt: a step change scrolls the step header to just under the sticky 56 px header. */}
      <div ref={columnRef} className="grid min-w-0 scroll-mt-16 gap-6 md:gap-12">
        {notice && (
          <p role="status" className="rounded-2xl bg-ivory-deep px-4 py-3 text-sm text-forest" data-order-notice>
            {notice}
          </p>
        )}
        {/* Phones only: where you are, and the way back. From md every section shows and there are no steps. */}
        <div className="md:hidden">
          <StepProgress current={step} total={ORDER_STEPS} label={stepLabel(step)}>
            {step > 0 && (
              <button
                type="button"
                onClick={back}
                disabled={settling}
                className="press -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-forest"
              >
                <span aria-hidden>←</span>
                {t.back}
              </button>
            )}
          </StepProgress>
        </div>

        {/* A step change (phones) cross-fades the sections: the old one leaves in 160 ms, the new one fades in and
            rises 12 px (globals.css, .order-step). Only for that transition type; nothing animates from md. */}
        <ViewTransition name="order-steps" update={{ "order-step": "order-step", default: "none" }} default="none">
          <div className="grid min-w-0 gap-12">
            {/* 01 · Plan */}
            <Section step={0} current={step} number="01" title={t.sections.plan} stepLabel={stepLabel(0)} help={help}>
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
                  {trialNote && ` ${trialNote}`}
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
                        changed();
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
            <Section step={1} current={step} number="02" title={t.sections.delivery} stepLabel={stepLabel(1)} help={help}>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={fieldId("address")} className="label text-muted">
                    {t.address}
                  </label>
                  {deliveryPrefilled && (address || comment) && (
                    <button
                      type="button"
                      onClick={clearDelivery}
                      aria-label={t.clearDeliveryLabel}
                      className="-my-2 inline-flex min-h-11 items-center px-1 text-sm font-semibold text-forest underline decoration-gold underline-offset-4"
                    >
                      {t.clearDelivery}
                    </button>
                  )}
                </div>
                {/* data-ph-mask: session replays never show the address (src/lib/analytics/client.ts). */}
                <textarea
                  data-ph-mask
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

              {canSaveDelivery && (
                <div className="flex items-start gap-3">
                  <input
                    id="order-save-delivery"
                    name="save_delivery"
                    type="checkbox"
                    checked={saveDelivery}
                    onChange={(e) => setSaveDelivery(e.target.checked)}
                    aria-describedby="order-save-delivery-hint"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-forest"
                  />
                  <div>
                    <label htmlFor="order-save-delivery" className="text-sm font-semibold text-graphite">
                      {t.saveDelivery}
                    </label>
                    <p id="order-save-delivery-hint" className="mt-0.5 text-sm text-muted">
                      {t.saveDeliveryHint}
                    </p>
                  </div>
                </div>
              )}
            </Section>

            {/* 03 · Contact */}
            <Section step={2} current={step} number="03" title={t.sections.contact} stepLabel={stepLabel(2)} help={help}>
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
                  aria-describedby={describedBy("exclusions", "order-exclusions-hint")}
                  className="field mt-2"
                />
                <p id="order-exclusions-hint" className="mt-1.5 text-sm text-muted">
                  {t.exclusionsHint}
                </p>
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

            {/* Bot check: invisible unless Cloudflare asks for a click; a new server answer starts a fresh one. */}
            <Turnstile siteKey={turnstileKey} action="order" locale={locale} resetKey={state} />

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
        </ViewTransition>
      </div>

      {/* Summary: side card from md, sticky bottom bar on phones */}
      <aside className="hidden md:block">
        <div className="sticky top-24">
          <div className="rounded-3xl bg-forest p-6 text-ivory">
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
            <button
              type="submit"
              disabled={pending}
              className={`btn btn-gold relative mt-5 w-full ${pending ? "opacity-60" : ""}`}
            >
              <ButtonLabel label={t.submit} pending={pending} pendingLabel={t.pending} />
            </button>
            <p className="mt-4 text-xs leading-relaxed text-ivory/60">{t.payNote}</p>
          </div>
          <div className="mt-3 px-2">{help}</div>
        </div>
      </aside>

      {/* Sticky (not fixed) so it stays with the form and never covers the footer. */}
      <div className="sticky bottom-0 z-30 -mx-5 border-t border-line bg-ivory/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted">{summaryLine}</p>
            <p className="font-serif text-xl text-forest tabular-nums">{money(total)}</p>
          </div>
          {/* Two different buttons (keys), so React never turns the Next under a finger into the Order button:
              Next (type="button") on steps 1–2, the submit button only on step 3. Both rest for SETTLE_MS after a
              step change. */}
          {step < LAST_STEP ? (
            <button
              key="next"
              type="button"
              onClick={next}
              disabled={settling}
              className="btn btn-forest shrink-0 !px-5"
            >
              {t.next}
            </button>
          ) : (
            <button
              key="submit"
              type="submit"
              disabled={pending || settling}
              className={`btn btn-forest relative shrink-0 !px-5 ${pending ? "opacity-60" : ""}`}
            >
              <ButtonLabel label={t.submit} pending={pending} pendingLabel={t.pending} />
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">{t.payNote}</p>
      </div>
    </form>
  );
}

/**
 * One of the form's three sections. On phones only the current step's section shows (the others are
 * display: none, still rendered and still submitted); from md all three always show.
 * The heading takes focus after a step change; on phones its name starts with "Step 2 of 3:".
 */
function Section({
  step,
  current,
  number,
  title,
  stepLabel,
  help,
  children,
}: {
  step: OrderStep;
  current: OrderStep;
  number: string;
  title: string;
  stepLabel: string;
  /** The Telegram line under the heading; phones only (from md it sits once under the summary). */
  help: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`grid gap-8 border-t border-gold pt-5 ${step === current ? "" : "max-md:hidden"}`}>
      <div>
        <h2
          id={stepHeadingId(step)}
          tabIndex={-1}
          className="flex items-baseline gap-3 font-serif text-3xl text-forest focus:outline-none"
        >
          <span className="sr-only md:hidden">{stepLabel}: </span>
          <span className="text-gold" aria-hidden>
            {number}
          </span>
          {title}
        </h2>
        <div className="mt-1 md:hidden">{help}</div>
      </div>
      {children}
    </section>
  );
}

/** A quiet "Questions? Ask in Telegram" line; the link is a 44 px tap target. */
function HelpLink({ text, link, href }: { text: string; link: string; href: string }) {
  return (
    <p className="text-sm text-muted">
      {text}{" "}
      <a
        href={href}
        rel="noopener"
        className="inline-flex min-h-11 items-center font-semibold text-forest underline decoration-gold underline-offset-4"
      >
        {link}
      </a>
    </p>
  );
}

/** The button's words; while sending, a spinner takes their place and the button keeps its width. */
function ButtonLabel({ label, pending, pendingLabel }: { label: string; pending: boolean; pendingLabel: string }) {
  return (
    <>
      <span className={pending ? "invisible" : undefined}>{label}</span>
      {pending && (
        <span className="absolute inset-0 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" className="size-5 animate-spin" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span className="sr-only">{pendingLabel}</span>
        </span>
      )}
    </>
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
    <p id={`${id}-error`} className="mt-2 text-sm font-semibold text-danger motion-safe:animate-fade">
      {text}
    </p>
  );
}
