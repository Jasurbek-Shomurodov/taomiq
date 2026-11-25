"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, locales, type Locale } from "@/i18n/config";
import { createOrder, editOrder, type StaffOrderState } from "@/lib/admin/order-actions";
import {
  STAFF_ORDER_FIELDS,
  checkContact,
  checkNote,
  checkSchedule,
  firstAllowedStart,
  hasErrors,
  staffPhone,
  staffStartRange,
  type StaffOrderErrors,
  type StaffOrderField,
} from "@/lib/admin/order-form";
import { STAFF_NOTE_MAX, formatDay, formatPhone } from "@/lib/admin/orders";
import { pricePerDay } from "@/lib/data/types";
import { LIMITS, addDays } from "@/lib/order/rules";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { TopBarActions } from "../../shell/TopBarSlot";

/*
 * The back office's order form (docs/plans/zarkebab-feature-port.md, slice 2): NewOrderForm (/orders/new) adds an order
 * taken by phone or Telegram; EditOrderForm (/orders/[id]/edit) changes an open order's contact and delivery fields,
 * and its schedule while it has not started. Both are full pages with the primary button in the top bar (it submits
 * the form by id). Fields are checked here with lib/admin/order-form.ts, again by the action, and by the database.
 * A field's problem shows once the form was sent (or the server named it), so nothing is red while it is typed.
 */

export type FormProgram = { id: string; name: string; variants: { id: string; kcal: number; price: number }[] };
export type FormDuration = { days: number; markup: number };

type Schedule = "daily" | "weekdays";

/** The server's field problems, kept until the person edits that field. */
function useFieldErrors(state: StaffOrderState) {
  const [server, setServer] = useState<StaffOrderErrors>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setServer(state.fields ?? {});
  }
  const clear = (field: StaffOrderField) =>
    setServer((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  return { server, clear };
}

/** Brings the notice at the top of the form into view after a failed send (the button sits in the top bar). */
function useScrollToProblem(state: StaffOrderState, attempt: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error || state.fields || attempt > 0) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state, attempt]);
  return ref;
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <span id={id} role="alert" className="text-[13px] font-medium text-adm-negative">
      {message}
    </span>
  );
}

/** A labelled control with its problem underneath; `describedBy` ties the message to the control. */
function Field({
  label,
  hint,
  error,
  errorId,
  className = "",
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error: string | null;
  errorId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`adm-label ${className}`}>
      {label}
      {children}
      {hint && <span className="adm-caption font-normal">{hint}</span>}
      <FieldError id={errorId} message={error} />
    </label>
  );
}

function FormNotice({
  innerRef,
  error,
  problems,
}: {
  innerRef: React.RefObject<HTMLDivElement | null>;
  error: string | undefined;
  problems: string | null;
}) {
  return (
    <div ref={innerRef} className="empty:hidden xl:col-span-2">
      {(error || problems) && <Notice tone="negative">{error ?? problems}</Notice>}
    </div>
  );
}

// ---------- contact and delivery fields (both forms) ----------

type Contact = {
  name: string;
  phone: string; // as typed
  address: string;
  window: string;
  comment: string;
  exclusions: string;
};

function contactInput(contact: Contact) {
  // Not exactly an Uzbek number: "", which the phone check refuses (never truncated into another number).
  return { ...contact, phone: staffPhone(contact.phone) ?? "" };
}

function ContactFields({
  contact,
  setContact,
  windows,
  removedWindow,
  phoneNote,
  problem,
  disabled,
  t,
}: {
  /** A line under the phone field (the edit form: the order is on a customer account). */
  phoneNote?: string;
  contact: Contact;
  setContact: (field: keyof Contact, value: string) => void;
  windows: readonly string[];
  /** The order's window when it is no longer in the settings: still offered, marked. */
  removedWindow: string | null;
  problem: (field: StaffOrderField) => { message: string | null; id: string; invalid: boolean };
  disabled: boolean;
  t: AdminDictionary;
}) {
  const f = t.orderForm;
  const p = {
    window: problem("window"),
    address: problem("address"),
    comment: problem("comment"),
    name: problem("name"),
    phone: problem("phone"),
    exclusions: problem("exclusions"),
  };
  const aria = (key: keyof typeof p) => ({
    "aria-invalid": p[key].invalid || undefined,
    "aria-describedby": p[key].message ? p[key].id : undefined,
  });

  return (
    <>
      <Panel title={f.sections.customer}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={f.name} error={p.name.message} errorId={p.name.id}>
            <input
              name="name"
              required
              maxLength={LIMITS.name.max}
              autoComplete="off"
              value={contact.name}
              onChange={(event) => setContact("name", event.target.value)}
              disabled={disabled}
              className="adm-input"
              data-ph-mask
              {...aria("name")}
            />
          </Field>
          <Field
            label={f.phone}
            hint={
              phoneNote ? (
                <>
                  {f.phoneHint}
                  <span className="mt-0.5 block">{phoneNote}</span>
                </>
              ) : (
                f.phoneHint
              )
            }
            error={p.phone.message}
            errorId={p.phone.id}
          >
            <input
              name="phone"
              type="tel"
              required
              inputMode="tel"
              autoComplete="off"
              maxLength={20}
              placeholder="+998 90 123-45-67"
              value={contact.phone}
              onChange={(event) => setContact("phone", event.target.value)}
              disabled={disabled}
              className="adm-input tabular-nums"
              data-ph-mask
              {...aria("phone")}
            />
          </Field>
        </div>
      </Panel>

      <Panel title={f.sections.delivery}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={f.address} error={p.address.message} errorId={p.address.id} className="sm:col-span-2">
            <textarea
              name="address"
              required
              rows={2}
              maxLength={LIMITS.address.max}
              value={contact.address}
              onChange={(event) => setContact("address", event.target.value)}
              disabled={disabled}
              className="adm-input font-normal"
              data-ph-mask
              {...aria("address")}
            />
          </Field>
          <Field label={f.window} error={p.window.message} errorId={p.window.id}>
            <select
              name="window"
              required
              value={contact.window}
              onChange={(event) => setContact("window", event.target.value)}
              disabled={disabled}
              className="adm-input font-normal tabular-nums"
              {...aria("window")}
            >
              {contact.window === "" && <option value="" disabled />}
              {removedWindow && <option value={removedWindow}>{f.windowRemoved(removedWindow)}</option>}
              {windows.map((window) => (
                <option key={window} value={window}>
                  {window}
                </option>
              ))}
            </select>
          </Field>
          <Field label={f.comment} error={p.comment.message} errorId={p.comment.id} className="sm:col-span-2">
            <textarea
              name="comment"
              rows={2}
              maxLength={LIMITS.comment}
              value={contact.comment}
              onChange={(event) => setContact("comment", event.target.value)}
              disabled={disabled}
              className="adm-input font-normal"
              data-ph-mask
              {...aria("comment")}
            />
          </Field>
          <Field label={f.exclusions} error={p.exclusions.message} errorId={p.exclusions.id} className="sm:col-span-2">
            <textarea
              name="exclusions"
              rows={2}
              maxLength={LIMITS.exclusions}
              value={contact.exclusions}
              onChange={(event) => setContact("exclusions", event.target.value)}
              disabled={disabled}
              className="adm-input font-normal"
              {...aria("exclusions")}
            />
          </Field>
        </div>
      </Panel>
    </>
  );
}

/** Schedule (every day or weekdays) and the first delivery date. */
function ScheduleFields({
  schedule,
  startDate,
  onSchedule,
  onStartDate,
  today,
  problem,
  disabled,
  t,
}: {
  schedule: Schedule;
  startDate: string;
  onSchedule: (schedule: Schedule) => void;
  onStartDate: (date: string) => void;
  today: string;
  problem: { message: string | null; id: string; invalid: boolean };
  disabled: boolean;
  t: AdminDictionary;
}) {
  const f = t.orderForm;
  const name = useId();
  const range = staffStartRange(today);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <fieldset disabled={disabled} className="grid content-start gap-2">
        <legend className="mb-1.5 text-sm font-semibold text-adm-text">{f.schedule}</legend>
        {(["daily", "weekdays"] as const).map((option) => (
          <label
            key={option}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-adm-btn border border-adm-border px-3 py-2 has-checked:border-adm-accent has-checked:bg-adm-accent-tint has-disabled:cursor-default"
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={schedule === option}
              onChange={() => onSchedule(option)}
              className="size-4 shrink-0"
            />
            <span className="text-sm text-adm-text">{option === "daily" ? f.everyDay : f.weekdaysOnly}</span>
          </label>
        ))}
        <input type="hidden" name="schedule" value={schedule} />
      </fieldset>
      <Field label={f.startDate} hint={f.startHint} error={problem.message} errorId={problem.id}>
        <input
          name="start_date"
          type="date"
          required
          min={range.earliest}
          max={range.latest}
          value={startDate}
          onChange={(event) => onStartDate(event.target.value)}
          disabled={disabled}
          className="adm-input font-normal tabular-nums"
          aria-invalid={problem.invalid || undefined}
          aria-describedby={problem.message ? problem.id : undefined}
        />
      </Field>
    </div>
  );
}

/** Field problems as messages: shown after a send, or when the server named the field. */
function useProblems(local: StaffOrderErrors, server: StaffOrderErrors, shown: boolean, t: AdminDictionary) {
  const baseId = useId();
  const problem = (field: StaffOrderField) => {
    const code = server[field] ?? (shown ? local[field] : undefined);
    return {
      message: code ? t.orderForm.fieldErrors[field] : null,
      id: `${baseId}-${field}`,
      invalid: Boolean(code),
    };
  };
  const any = STAFF_ORDER_FIELDS.some((field) => server[field] || (shown && local[field]));
  return { problem, any };
}

function SubmitButton({
  formId,
  pending,
  disabled,
  label,
  pendingLabel,
}: {
  formId: string;
  pending: boolean;
  disabled: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <button
      type="submit"
      form={formId}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      className="adm-btn adm-btn-primary"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

// ---------- new order ----------

const NEW_FORM_ID = "new-order-form";

export function NewOrderForm({
  programs,
  durations,
  windows,
  today,
  locale,
}: {
  programs: FormProgram[];
  durations: FormDuration[];
  windows: string[];
  /** Tashkent day, "YYYY-MM-DD". */
  today: string;
  locale: Locale;
}) {
  const [state, action, pending] = useActionState<StaffOrderState, FormData>(createOrder, {});
  const t = getAdminDictionary(locale);
  const f = t.orderForm;

  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const program = programs.find((p) => p.id === programId) ?? programs[0];
  const [variantId, setVariantId] = useState(program?.variants[0]?.id ?? "");
  const variant = program?.variants.find((v) => v.id === variantId) ?? program?.variants[0];
  const [days, setDays] = useState(durations[0]?.days ?? 0);
  const duration = durations.find((d) => d.days === days);
  const [schedule, setSchedule] = useState<Schedule>("daily");
  const [startDate, setStartDate] = useState(addDays(today, 1));
  const [contact, setContactState] = useState<Contact>({
    name: "",
    phone: "",
    address: "",
    window: windows[0] ?? "",
    comment: "",
    exclusions: "",
  });
  const [note, setNote] = useState("");
  const [customerLocale, setCustomerLocale] = useState<Locale>(locale);

  const { server, clear } = useFieldErrors(state);
  const [shown, setShown] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const noticeRef = useScrollToProblem(state, attempt);

  const local: StaffOrderErrors = {
    ...(variant ? {} : { plan: "invalid" }),
    ...(duration ? {} : { duration: "invalid" }),
    ...checkSchedule({ startDate, weekdaysOnly: schedule === "weekdays" }, today),
    ...checkContact(contactInput(contact), windows),
    ...checkNote(note),
  };
  const { problem, any } = useProblems(local, server, shown, t);

  const setContact = (field: keyof Contact, value: string) => {
    setContactState((current) => ({ ...current, [field]: value }));
    clear(field);
  };

  const perDay = variant && duration ? pricePerDay(variant.price, duration.markup) : null;
  const sum = (amount: number) => `${formatSum(amount)} ${t.common.currency}`;
  const planProblem = problem("plan");
  const durationProblem = problem("duration");
  const noteProblem = problem("note");

  const button = (
    <SubmitButton formId={NEW_FORM_ID} pending={pending} disabled={false} label={f.create} pendingLabel={f.creating} />
  );

  return (
    <>
      <TopBarActions>{button}</TopBarActions>
      <form
        id={NEW_FORM_ID}
        action={action}
        noValidate
        onSubmit={(event) => {
          if (hasErrors(local)) {
            event.preventDefault();
            setShown(true);
            setAttempt((n) => n + 1);
          }
        }}
        className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start"
      >
        <FormNotice innerRef={noticeRef} error={state.error} problems={any ? f.problems : null} />

        <div className="grid min-w-0 content-start gap-5">
          <p className="adm-muted">{f.lead}</p>

          <Panel title={f.sections.plan}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={f.program} error={planProblem.message} errorId={planProblem.id}>
                <select
                  value={program?.id ?? ""}
                  onChange={(event) => {
                    const next = programs.find((p) => p.id === event.target.value);
                    setProgramId(event.target.value);
                    setVariantId(next?.variants[0]?.id ?? "");
                    clear("plan");
                  }}
                  disabled={pending}
                  className="adm-input font-normal"
                  aria-invalid={planProblem.invalid || undefined}
                >
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={f.level} error={null} errorId={`${planProblem.id}-level`}>
                <select
                  name="variant_id"
                  value={variant?.id ?? ""}
                  onChange={(event) => {
                    setVariantId(event.target.value);
                    clear("plan");
                  }}
                  disabled={pending}
                  className="adm-input font-normal tabular-nums"
                >
                  {program?.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.kcal} {t.common.kcal}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={f.days} error={durationProblem.message} errorId={durationProblem.id}>
                <select
                  name="days"
                  value={String(days)}
                  onChange={(event) => {
                    setDays(Number(event.target.value));
                    clear("duration");
                  }}
                  disabled={pending}
                  className="adm-input font-normal tabular-nums"
                  aria-invalid={durationProblem.invalid || undefined}
                >
                  {durations.map((d) => (
                    <option key={d.days} value={d.days}>
                      {f.daysOption(d.days)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Panel>

          <Panel title={f.sections.schedule}>
            <ScheduleFields
              schedule={schedule}
              startDate={startDate}
              onSchedule={(next) => {
                setSchedule(next);
                if (next === "weekdays") setStartDate((date) => firstAllowedStart(date, true));
                clear("start");
              }}
              onStartDate={(date) => {
                setStartDate(date);
                clear("start");
              }}
              today={today}
              problem={problem("start")}
              disabled={pending}
              t={t}
            />
          </Panel>

          <ContactFields
            contact={contact}
            setContact={setContact}
            windows={windows}
            removedWindow={null}
            problem={problem}
            disabled={pending}
            t={t}
          />

          <Panel title={f.sections.team}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={f.note} error={noteProblem.message} errorId={noteProblem.id} className="sm:col-span-2">
                <textarea
                  name="staff_note"
                  rows={3}
                  maxLength={STAFF_NOTE_MAX}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                    clear("note");
                  }}
                  placeholder={t.order.notePlaceholder}
                  disabled={pending}
                  className="adm-input font-normal"
                  aria-invalid={noteProblem.invalid || undefined}
                />
              </Field>
              <label className="adm-label">
                {f.language}
                <select
                  name="locale"
                  value={customerLocale}
                  onChange={(event) => setCustomerLocale(event.target.value as Locale)}
                  disabled={pending}
                  className="adm-input font-normal"
                >
                  {locales.map((option) => (
                    <option key={option} value={option}>
                      {t.order.siteLocales[option]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Panel>
        </div>

        <aside className="grid min-w-0 content-start gap-5 xl:sticky xl:top-6">
          <Panel title={t.order.programPayment}>
            <dl className="grid gap-2" aria-live="polite">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-adm-muted">{f.pricePerDay}</dt>
                <dd className="tabular-nums text-adm-text">{perDay !== null ? sum(perDay) : "—"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-adm-muted">{f.total}</dt>
                <dd className="text-lg font-semibold tabular-nums text-adm-text">
                  {perDay !== null && duration ? sum(perDay * duration.days) : "—"}
                </dd>
              </div>
            </dl>
            <p className="adm-caption mt-3">{f.priceHint}</p>
          </Panel>
        </aside>

        <BeforeHydration>
          <div className="xl:col-span-2">{button}</div>
        </BeforeHydration>
      </form>
    </>
  );
}

// ---------- edit ----------

const EDIT_FORM_ID = "edit-order-form";

export type EditableOrder = {
  id: string;
  number: number;
  updated_at: string;
  customer_name: string;
  phone: string;
  address: string;
  delivery_window: string;
  comment: string;
  exclusions: string;
  start_date: string;
  weekdays_only: boolean;
  /** The order is on a customer account (user_id set): a new phone takes it off. */
  linked: boolean;
};

export function EditOrderForm({
  order,
  windows,
  today,
  scheduleEditable,
  locale,
}: {
  order: EditableOrder;
  windows: string[];
  today: string;
  /** canEditSchedule(order, today): the order has not started. */
  scheduleEditable: boolean;
  locale: Locale;
}) {
  const [state, action, pending] = useActionState<StaffOrderState, FormData>(editOrder, {});
  const t = getAdminDictionary(locale);
  const f = t.orderForm;

  const initial: Contact = {
    name: order.customer_name,
    phone: formatPhone(order.phone),
    address: order.address,
    window: order.delivery_window,
    comment: order.comment,
    exclusions: order.exclusions,
  };
  const initialSchedule: Schedule = order.weekdays_only ? "weekdays" : "daily";
  const [contact, setContactState] = useState<Contact>(initial);
  const [schedule, setSchedule] = useState<Schedule>(initialSchedule);
  const [startDate, setStartDate] = useState(order.start_date);

  const { server, clear } = useFieldErrors(state);
  const [shown, setShown] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const noticeRef = useScrollToProblem(state, attempt);

  const scheduleChanged = startDate !== order.start_date || schedule !== initialSchedule;
  const contactChanged =
    contact.name.trim() !== initial.name ||
    (staffPhone(contact.phone) ?? contact.phone) !== order.phone ||
    contact.address.trim() !== initial.address ||
    contact.window !== initial.window ||
    contact.comment.trim() !== initial.comment ||
    contact.exclusions.trim() !== initial.exclusions;
  const changed = contactChanged || scheduleChanged;

  const removedWindow = windows.includes(order.delivery_window) ? null : order.delivery_window;
  const local: StaffOrderErrors = {
    ...checkContact(contactInput(contact), windows, order.delivery_window),
    ...(scheduleChanged ? checkSchedule({ startDate, weekdaysOnly: schedule === "weekdays" }, today) : {}),
  };
  const { problem, any } = useProblems(local, server, shown, t);

  const setContact = (field: keyof Contact, value: string) => {
    setContactState((current) => ({ ...current, [field]: value }));
    clear(field);
  };

  const button = (
    <SubmitButton formId={EDIT_FORM_ID} pending={pending} disabled={!changed} label={t.common.save} pendingLabel={t.common.saving} />
  );

  return (
    <>
      <TopBarActions>{button}</TopBarActions>
      <form
        id={EDIT_FORM_ID}
        action={action}
        noValidate
        onSubmit={(event) => {
          if (!changed || hasErrors(local)) {
            event.preventDefault();
            setShown(true);
            setAttempt((n) => n + 1);
          }
        }}
        className="grid max-w-4xl gap-5"
      >
        <input type="hidden" name="id" value={order.id} />
        <input type="hidden" name="loaded_at" value={order.updated_at} />
        <input type="hidden" name="loaded_start_date" value={order.start_date} />
        <input type="hidden" name="loaded_schedule" value={initialSchedule} />

        <FormNotice innerRef={noticeRef} error={state.error} problems={any ? f.problems : null} />
        <p className="adm-muted">
          {f.editLead} {f.fixed}
        </p>

        <Panel title={f.sections.schedule}>
          {scheduleEditable ? (
            <ScheduleFields
              schedule={schedule}
              startDate={startDate}
              onSchedule={(next) => {
                setSchedule(next);
                if (next === "weekdays") setStartDate((date) => firstAllowedStart(date, true));
                clear("start");
              }}
              onStartDate={(date) => {
                setStartDate(date);
                clear("start");
              }}
              today={today}
              problem={problem("start")}
              disabled={pending}
              t={t}
            />
          ) : (
            <>
              <input type="hidden" name="schedule" value={initialSchedule} />
              <input type="hidden" name="start_date" value={order.start_date} />
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[11rem_1fr]">
                <dt className="text-sm text-adm-muted">{f.startDate}</dt>
                <dd className="tabular-nums text-adm-text">{formatDay(order.start_date, locale)}</dd>
                <dt className="text-sm text-adm-muted">{f.schedule}</dt>
                <dd className="text-adm-text">{order.weekdays_only ? f.weekdaysOnly : f.everyDay}</dd>
              </dl>
              <p className="adm-caption mt-3">{f.scheduleLocked}</p>
            </>
          )}
        </Panel>

        <ContactFields
          contact={contact}
          setContact={setContact}
          windows={windows}
          removedWindow={removedWindow}
          phoneNote={order.linked ? f.linkedPhone : undefined}
          problem={problem}
          disabled={pending}
          t={t}
        />

        <BeforeHydration>
          <div>{button}</div>
        </BeforeHydration>
      </form>
    </>
  );
}
