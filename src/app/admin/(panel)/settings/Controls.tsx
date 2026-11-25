"use client";

import { LoaderCircle, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useActionState, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { addFeeRate, deleteFeeRate, saveBackdateDays, saveFinanceSetting } from "@/lib/admin/finance/actions";
import {
  FEE_LIMITS,
  FEE_METHODS,
  feeRateOn,
  formatFeeRate,
  readFeeRateInput,
  type FeeMethod,
  type FeeRate,
} from "@/lib/admin/finance/fees";
import { formatEntryDay } from "@/lib/admin/finance/month";
import {
  BACKDATE_LIMITS,
  FINANCE_SETTING_LIMITS,
  readBackdateInput,
  readFinanceSettingInput,
  type FinanceSettingName,
} from "@/lib/admin/finance/settings";
import { formatPhone } from "@/lib/admin/orders";
import {
  saveContactPhone,
  saveContactTelegram,
  saveCutoffHour,
  saveCycleAnchor,
  saveDeliveryWindows,
} from "@/lib/admin/settings";
import {
  SETTING_LIMITS,
  checkWindows,
  cycleDayOn,
  joinWindow,
  readContactPhone,
  readContactTelegram,
  readCutoffHour,
  readCycleAnchor,
  splitWindow,
  type DeliveryWindow,
} from "@/lib/admin/settings-rules";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { setAdminTheme, useAdminTheme } from "../../shell/theme";
import { FormMessage } from "../finance/payroll/FormMessage";

/*
 * The Settings screen's controls (docs/plans/zarkebab-feature-port.md, slice 1). Each is its own form with its own Save:
 * off until the value changed and is valid, a spinner while it saves, then "Saved" or the reason it failed beside it.
 * The value is checked here with the same rules the action (lib/admin/settings.ts) and the database check again.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/**
 * One settings row: the label (and a hint) on the left, the control on the right; on phones the control drops under
 * its label at full width. `htmlFor` ties the label to one input; without it the row is a group named by its label.
 */
export function SettingRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const group = htmlFor ? {} : { role: "group", "aria-labelledby": labelId };
  return (
    <div {...group} className="adm-row flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
      <div className="min-w-0 basis-full sm:basis-56 sm:shrink-0 sm:pt-2.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm font-semibold text-adm-text">
            {label}
          </label>
        ) : (
          <p id={labelId} className="text-sm font-semibold text-adm-text">
            {label}
          </p>
        )}
        {hint && <p className="adm-caption mt-0.5">{hint}</p>}
      </div>
      <div className="grid min-w-0 flex-1 basis-full gap-3 sm:basis-0">{children}</div>
    </div>
  );
}

/**
 * A save action with the outcome of its last run as a message that an edit clears. `onSaved` runs once per successful
 * save, during render (a state update of the same component), so the control can take the saved value as its new
 * starting point.
 */
function useSave(action: Action, onSaved: () => void) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [message, setMessage] = useState<FormState>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setMessage(state);
    if (state.ok) onSaved();
  }
  return { formAction, pending, message, clear: () => setMessage({}) };
}

/** Save and, beside it, the last outcome; while nothing is wrong with the value, also why Save is off (`problem`). */
function SaveLine({
  pending,
  disabled,
  message,
  problem,
  locale,
}: {
  pending: boolean;
  disabled: boolean;
  message: FormState;
  problem: string | null;
  locale: Locale;
}) {
  const s = getAdminDictionary(locale).settings;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="submit"
        disabled={pending || disabled}
        aria-busy={pending || undefined}
        className="adm-btn adm-btn-outline"
      >
        {pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
        {pending ? s.saving : s.save}
      </button>
      {problem && !pending && !message.error ? (
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-adm-caution">
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {problem}
        </span>
      ) : (
        <FormMessage message={message} pending={pending} />
      )}
    </div>
  );
}

// ---------- one-field controls ----------

/** What a field's text means: its canonical form (compared with the saved one) or why it cannot be saved. */
type Reading = { value: string } | { problem: string };

function SingleField({
  id,
  label,
  hint,
  action,
  name = "value",
  initialText,
  savedValue,
  read,
  hidden,
  input,
  after,
  locale,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  action: Action;
  name?: string;
  /** The text the field starts with. */
  initialText: string;
  /** The canonical form of the saved value, as `read` returns it. */
  savedValue: string;
  read: (text: string) => Reading;
  hidden?: Record<string, string>;
  input: InputHTMLAttributes<HTMLInputElement>;
  /** Shown under the field, from what is typed now (a preview, a warning). */
  after?: (reading: Reading, changed: boolean) => ReactNode;
  locale: Locale;
}) {
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState(savedValue);
  const reading = read(text);
  const changed = "value" in reading ? reading.value !== saved : true;
  const { formAction, pending, message, clear } = useSave(action, () => {
    if ("value" in reading) setSaved(reading.value);
  });
  const problem = "problem" in reading && text !== initialText ? reading.problem : null;

  return (
    <SettingRow label={label} hint={hint} htmlFor={id}>
      <form action={formAction} className="grid gap-3">
        {Object.entries(hidden ?? {}).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <input
          id={id}
          name={name}
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            if (message.ok || message.error) clear();
          }}
          disabled={pending}
          aria-invalid={problem ? true : undefined}
          autoComplete="off"
          className="adm-input max-w-sm"
          {...input}
        />
        {after?.(reading, changed)}
        <SaveLine
          pending={pending}
          disabled={!changed || "problem" in reading}
          message={message}
          problem={problem}
          locale={locale}
        />
      </form>
    </SettingRow>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function CutoffField({ initial, locale }: { initial: number; locale: Locale }) {
  const s = getAdminDictionary(locale).settings;
  return (
    <SingleField
      id="setting-cutoff"
      label={s.cutoff.label}
      hint={s.cutoff.hint}
      action={saveCutoffHour}
      initialText={String(initial)}
      savedValue={String(initial)}
      read={(text) => {
        const hour = readCutoffHour(text);
        return hour === null ? { problem: s.errors.cutoff } : { value: String(hour) };
      }}
      input={{
        type: "number",
        inputMode: "numeric",
        min: SETTING_LIMITS.cutoffMin,
        max: SETTING_LIMITS.cutoffMax,
        step: 1,
        className: "adm-input w-28 tabular-nums",
      }}
      after={(reading) =>
        "value" in reading && (
          <p className="adm-caption">{s.cutoff.preview(reading.value === "0" ? null : `${pad2(Number(reading.value))}:00`)}</p>
        )
      }
      locale={locale}
    />
  );
}

export function AnchorField({ initial, today, locale }: { initial: string; today: string; locale: Locale }) {
  const s = getAdminDictionary(locale).settings;
  return (
    <SingleField
      id="setting-anchor"
      label={s.anchor.label}
      hint={s.anchor.hint}
      action={saveCycleAnchor}
      initialText={initial}
      savedValue={initial}
      read={(text) => {
        const anchor = readCycleAnchor(text);
        return anchor === null ? { problem: s.errors.anchor } : { value: anchor };
      }}
      input={{ type: "date", className: "adm-input w-48 tabular-nums" }}
      after={(reading, changed) =>
        "value" in reading && (
          <>
            <p className="adm-caption">{s.anchor.today(cycleDayOn(today, reading.value))}</p>
            {changed && (
              <p role="note" className="adm-tone-caution flex items-start gap-2 rounded-adm-control px-3 py-2 text-[13px]">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">{s.anchor.warning}</span>
              </p>
            )}
          </>
        )
      }
      locale={locale}
    />
  );
}

export function PhoneField({ initial, locale }: { initial: string; locale: Locale }) {
  const s = getAdminDictionary(locale).settings;
  return (
    <SingleField
      id="setting-phone"
      label={s.phone.label}
      hint={s.phone.hint}
      action={saveContactPhone}
      initialText={initial ? formatPhone(initial) : ""}
      savedValue={initial}
      read={(text) => {
        const phone = readContactPhone(text);
        return phone === null ? { problem: s.errors.phone } : { value: phone };
      }}
      input={{ type: "tel", inputMode: "tel", maxLength: 24, placeholder: s.phone.placeholder }}
      locale={locale}
    />
  );
}

export function TelegramField({ initial, locale }: { initial: string; locale: Locale }) {
  const s = getAdminDictionary(locale).settings;
  return (
    <SingleField
      id="setting-telegram"
      label={s.telegram.label}
      hint={s.telegram.hint}
      action={saveContactTelegram}
      initialText={initial ? `@${initial}` : ""}
      savedValue={initial}
      read={(text) => {
        const username = readContactTelegram(text);
        return username === null ? { problem: s.errors.telegram } : { value: username };
      }}
      input={{ type: "text", maxLength: 64, placeholder: s.telegram.placeholder, spellCheck: false, autoCapitalize: "none" }}
      locale={locale}
    />
  );
}

/** A saved finance value as the field shows it: amounts grouped ("6 000 000"), the rate as stored ("4.5"). */
function financeText(name: FinanceSettingName, value: number | null): string {
  if (value === null) return "";
  return name === "taxRatePct" ? String(value) : formatSum(value);
}

/** One of the three finance settings (finance/settings.ts); an empty field clears it. */
export function FinanceField({
  name,
  initial,
  locale,
}: {
  name: FinanceSettingName;
  initial: number | null;
  locale: Locale;
}) {
  const f = getAdminDictionary(locale).finance.settings;
  return (
    <SingleField
      id={`setting-finance-${name}`}
      label={f.fields[name]}
      hint={f.hints[name]}
      action={saveFinanceSetting}
      hidden={{ name }}
      initialText={financeText(name, initial)}
      savedValue={initial === null ? "" : String(initial)}
      read={(text) => {
        const input = readFinanceSettingInput(name, text);
        if (!("error" in input)) return { value: input.value === null ? "" : String(input.value) };
        if (input.error === "amount") return { problem: f.errors.amount(f.fields[name]) };
        if (input.error === "amountRange") {
          return { problem: f.errors.amountRange(f.fields[name], formatSum(FINANCE_SETTING_LIMITS.amountMax)) };
        }
        return { problem: f.errors.tax };
      }}
      input={{
        type: "text",
        inputMode: name === "taxRatePct" ? "decimal" : "numeric",
        maxLength: 20,
        placeholder: f.placeholders[name],
        className: "adm-input max-w-xs tabular-nums",
      }}
      locale={locale}
    />
  );
}

/** How many days back a record may be dated by hand (finance_backdate_days, 0..31; 3 when never set). */
export function BackdateField({ initial, locale }: { initial: number; locale: Locale }) {
  const b = getAdminDictionary(locale).finance.backdate;
  return (
    <SingleField
      id="setting-finance-backdate"
      label={b.label}
      hint={b.settingHint}
      action={saveBackdateDays}
      initialText={String(initial)}
      savedValue={String(initial)}
      read={(text) => {
        const days = readBackdateInput(text);
        return days === null ? { problem: b.errors.range } : { value: String(days) };
      }}
      input={{
        type: "number",
        inputMode: "numeric",
        min: BACKDATE_LIMITS.min,
        max: BACKDATE_LIMITS.max,
        step: 1,
        className: "adm-input w-28 tabular-nums",
      }}
      after={(reading) => "value" in reading && <p className="adm-caption">{b.daysValue(Number(reading.value))}</p>}
      locale={locale}
    />
  );
}

// ---------- bank fee rates (migration 0024) ----------

/**
 * Bank fee rates by method, each from a day on: the list (the rate in force today marked, later ones too), a bin per
 * rate (asks first), and a form for a new one. The list is the server's (the page refreshes after each change).
 */
export function FeeRatesField({ rates, today, locale }: { rates: FeeRate[]; today: string; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const f = t.finance.fees;
  const id = useId();
  const [method, setMethod] = useState<FeeMethod>("card");
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState(today);
  const bp = readFeeRateInput(rate);
  const { formAction, pending, message, clear } = useSave(addFeeRate, () => setRate(""));
  const problem = rate.trim() && bp === null ? f.errors.rate(FEE_LIMITS.pctMax) : null;
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      if (message.ok || message.error) clear();
    };

  return (
    <SettingRow label={f.label} hint={f.hint}>
      <div className="grid gap-4">
        {rates.length === 0 ? (
          <p className="adm-caption sm:pt-2.5">{f.empty}</p>
        ) : (
          <ul className="grid gap-2">
            {FEE_METHODS.flatMap((m) => {
              const current = feeRateOn(rates, m, today);
              return rates
                .filter((r) => r.method === m)
                .map((r) => (
                  <FeeRateRow
                    key={r.id}
                    rate={r}
                    status={r.effective_from > today ? "later" : current?.id === r.id ? "inForce" : null}
                    locale={locale}
                  />
                ));
            })}
          </ul>
        )}

        <form action={formAction} className="grid gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="adm-label w-36 text-[13px] font-medium" htmlFor={`${id}-method`}>
              {f.method}
              <select
                id={`${id}-method`}
                name="method"
                value={method}
                onChange={(event) => edit(setMethod)(event.currentTarget.value as FeeMethod)}
                disabled={pending}
                className="adm-input"
              >
                {FEE_METHODS.map((option) => (
                  <option key={option} value={option}>
                    {f.methods[option]}
                  </option>
                ))}
              </select>
            </label>
            <label className="adm-label w-28 text-[13px] font-medium" htmlFor={`${id}-rate`}>
              {f.rate}
              <input
                id={`${id}-rate`}
                name="rate"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                maxLength={8}
                placeholder={f.ratePlaceholder}
                value={rate}
                onChange={(event) => edit(setRate)(event.currentTarget.value)}
                disabled={pending}
                aria-invalid={problem ? true : undefined}
                className="adm-input tabular-nums"
              />
            </label>
            <label className="adm-label w-44 text-[13px] font-medium" htmlFor={`${id}-from`}>
              {f.from}
              <input
                id={`${id}-from`}
                name="effective_from"
                type="date"
                min={FEE_LIMITS.firstDay}
                value={from}
                onChange={(event) => edit(setFrom)(event.currentTarget.value)}
                disabled={pending}
                required
                className="adm-input tabular-nums"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="submit"
              disabled={pending || bp === null || !from}
              aria-busy={pending || undefined}
              className="adm-btn adm-btn-outline"
            >
              {pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {pending ? f.adding : f.add}
            </button>
            {problem && !pending && !message.error ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-adm-caution">
                <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                {problem}
              </span>
            ) : (
              <FormMessage message={message} pending={pending} />
            )}
          </div>
        </form>
      </div>
    </SettingRow>
  );
}

function FeeRateRow({
  rate,
  status,
  locale,
}: {
  rate: FeeRate;
  status: "inForce" | "later" | null;
  locale: Locale;
}) {
  const t = getAdminDictionary(locale);
  const f = t.finance.fees;
  const [state, remove, removing] = useActionState<FormState, FormData>(deleteFeeRate, {});
  const what = `${f.methods[rate.method]} · ${formatFeeRate(rate.rate_bp, locale)} · ${f.fromDay(formatEntryDay(rate.effective_from, locale))}`;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-adm-control border border-adm-border px-3 py-2">
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-semibold text-adm-text">{f.methods[rate.method]}</span>{" "}
        <span className="font-semibold tabular-nums text-adm-text">{formatFeeRate(rate.rate_bp, locale)}</span>{" "}
        <span className="adm-caption tabular-nums">{f.fromDay(formatEntryDay(rate.effective_from, locale))}</span>
        {status && (
          <span className={`adm-badge ml-2 ${status === "inForce" ? "adm-tone-positive" : "adm-tone-neutral"}`}>
            {f[status]}
          </span>
        )}
      </span>
      <form action={remove}>
        <input type="hidden" name="id" value={rate.id} />
        <ConfirmDialog
          trigger={
            <>
              <Trash2 aria-hidden="true" />
              <span className="sr-only">{f.remove(what)}</span>
            </>
          }
          triggerClassName="adm-btn adm-btn-ghost adm-btn-danger adm-btn-sm adm-btn-icon"
          disabled={removing}
          title={f.removeTitle}
          description={f.removeText(what)}
          confirmLabel={f.removeConfirm}
          pendingLabel={f.removing}
          cancelLabel={t.common.cancel}
          destructive
          pending={removing}
        />
      </form>
      {!removing && state.error && (
        <p role="alert" className="basis-full text-[13px] font-medium text-adm-negative">
          {state.error}
        </p>
      )}
    </li>
  );
}

// ---------- delivery windows ----------

type WindowItem = DeliveryWindow & { id: number };

const windowsKey = (windows: readonly DeliveryWindow[]) => windows.map(joinWindow).join("|");

/** The delivery windows: a list of start–end times, at least one, saved together in the order shown. */
export function WindowsField({ initial, locale }: { initial: string[]; locale: Locale }) {
  const s = getAdminDictionary(locale).settings;
  const [items, setItems] = useState<WindowItem[]>(() => initial.map((w, id) => ({ ...splitWindow(w), id })));
  const [nextId, setNextId] = useState(initial.length);
  const [saved, setSaved] = useState(() => windowsKey(initial.map(splitWindow)));
  const [savedList, setSavedList] = useState(initial);
  const [touched, setTouched] = useState(false);

  const current = windowsKey(items);
  const check = checkWindows(items);
  const problem =
    check === null || !touched
      ? null
      : check === "empty"
        ? s.errors.windowsEmpty
        : check === "tooMany"
          ? s.errors.windowsTooMany(SETTING_LIMITS.windowsMax)
          : check === "time"
            ? s.errors.windowsTime
            : check === "order"
              ? s.errors.windowsOrder
              : s.errors.windowsDuplicate;
  const { formAction, pending, message, clear } = useSave(saveDeliveryWindows, () => {
    setSaved(current);
    setSavedList(items.map(joinWindow));
    setTouched(false);
  });
  const removed = savedList.some((w) => !items.some((item) => joinWindow(item) === w));

  const edit = (update: (list: WindowItem[]) => WindowItem[]) => {
    setItems(update);
    setTouched(true);
    if (message.ok || message.error) clear();
  };
  const setTime = (id: number, part: "from" | "to", value: string) =>
    edit((list) => list.map((item) => (item.id === id ? { ...item, [part]: value } : item)));

  return (
    <SettingRow label={s.windows.label} hint={s.windows.hint}>
      <form action={formAction} className="grid gap-3">
        <ol className="grid gap-2">
          {items.map((item, index) => {
            const n = index + 1;
            const bad = touched && checkWindows([item]) !== null;
            return (
              <li key={item.id} className="flex flex-wrap items-end gap-2" aria-label={s.windows.window(n)}>
                <label className="adm-label w-32 text-[13px] font-medium">
                  {s.windows.from}
                  <input
                    type="time"
                    name="from"
                    value={item.from}
                    onChange={(event) => setTime(item.id, "from", event.currentTarget.value)}
                    disabled={pending}
                    required
                    aria-invalid={bad || undefined}
                    className="adm-input tabular-nums"
                  />
                </label>
                <label className="adm-label w-32 text-[13px] font-medium">
                  {s.windows.to}
                  <input
                    type="time"
                    name="to"
                    value={item.to}
                    onChange={(event) => setTime(item.id, "to", event.currentTarget.value)}
                    disabled={pending}
                    required
                    aria-invalid={bad || undefined}
                    className="adm-input tabular-nums"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => edit((list) => list.filter((entry) => entry.id !== item.id))}
                  disabled={pending || items.length <= 1}
                  aria-label={s.windows.remove(n)}
                  title={items.length <= 1 ? s.windows.lastOne : s.windows.remove(n)}
                  className="adm-btn adm-btn-ghost adm-btn-icon hover:text-adm-negative"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
        <div>
          <button
            type="button"
            onClick={() => {
              edit((list) => [...list, { id: nextId, from: "", to: "" }]);
              setNextId((id) => id + 1);
            }}
            disabled={pending || items.length >= SETTING_LIMITS.windowsMax}
            className="adm-btn adm-btn-ghost adm-btn-sm"
          >
            <Plus aria-hidden="true" />
            {s.windows.add}
          </button>
        </div>
        {removed && <p className="adm-caption">{s.windows.removedNote}</p>}
        <SaveLine
          pending={pending}
          disabled={current === saved || check !== null}
          message={message}
          problem={problem}
          locale={locale}
        />
      </form>
    </SettingRow>
  );
}

// ---------- appearance ----------

/** Light or dark for this device: the same switch as the top bar's toggle (shell/theme.tsx), applied at once. */
export function ThemeChoice({ locale }: { locale: Locale }) {
  const s = getAdminDictionary(locale).settings.appearance;
  const theme = useAdminTheme();
  return (
    <div role="group" aria-label={s.theme} className="adm-segmented">
      {(["light", "dark"] as const).map((option) => (
        <button key={option} type="button" aria-pressed={theme === option} onClick={() => setAdminTheme(option)}>
          {s[option]}
        </button>
      ))}
    </div>
  );
}
