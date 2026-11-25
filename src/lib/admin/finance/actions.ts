"use server";

import { refresh } from "next/cache";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum } from "@/i18n/config";
import type { FormState } from "../actions";
import { requireOwner } from "../auth";
import { addDays, tashkentDay } from "../stats";
import {
  FINANCE_LIMITS,
  isEntryKind,
  isExpenseCategory,
  isPaymentMethod,
  kindToRow,
} from "./categories";
import { FEE_LIMITS, isFeeMethod, readFeeRateInput } from "./fees";
import { formatEntryDay, formatMonth, isCalendarDay } from "./month";
import { isRateUnit, isSalaryEventKind, PAYROLL_LIMITS } from "./payroll";
import { loadBackdateDays, loadLockedThrough } from "./queries";
import {
  BACKDATE_SETTING_KEY,
  CLOSE_LIMITS,
  backdateEarliest,
  readBackdateInput,
  FINANCE_SETTING_KEYS,
  FINANCE_SETTING_LIMITS,
  isFinanceSettingName,
  readFinanceSettingInput,
} from "./settings";

/*
 * Finance ledger, payroll, month close and settings writes (migrations 0013, 0014, 0015 and 0024), owner only. Each action
 * checks the owner first (requireOwner redirects anyone else), then validates everything the table checks again, so a
 * refusal from the database is the exception. Database errors are logged with their code and shown as a sentence in
 * the owner's language, never raw.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The guard of a closed month (migration 0015) refused the write: the record is dated in a closed month (or, for a
 * rate or a leaving, changes pay there). Checked before any other error code.
 */
function isMonthClosed(error: { message: string }): boolean {
  return error.message.includes("month_closed");
}

/**
 * Postgres deadlock_detected: a write and a month close (which locks the payroll and ledger tables) waited on each
 * other and the database rolled one back. Nothing was saved; trying again works.
 */
const DEADLOCK = "40P01";

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

type Dictionary = ReturnType<typeof getAdminDictionary>;
type Session = Awaited<ReturnType<typeof requireOwner>>;

/**
 * Why a day typed by hand is too far back (migration 0024: today or up to finance_backdate_days back, 3 when not
 * set), or null when it is inside the window or in a closed month (that refusal comes from the database, and is
 * reported as a closed month). When the setting cannot be read the database still checks
 * (backdate_limit), so the check is skipped rather than guessed.
 */
async function backdateRefusal(session: Session, t: Dictionary, day: string, today: string): Promise<string | null> {
  let days: number;
  let lockedThrough: string | null;
  try {
    [days, lockedThrough] = await Promise.all([loadBackdateDays(session.supabase), loadLockedThrough(session.supabase)]);
  } catch (error) {
    console.error("finance: read backdate days failed", error instanceof Error ? error.message : error);
    return null;
  }
  // A day in a closed month: the closed-month guard refuses it first (month_closed) and the action says so, rather
  // than suggesting to raise the limit.
  if (lockedThrough !== null && day <= lockedThrough) return null;
  const earliest = backdateEarliest(today, days);
  return day < earliest ? t.finance.backdate.tooOld(days, formatEntryDay(earliest, session.staff.locale)) : null;
}

/** The database's own refusal of a day too far back (backdate_limit; detail: the earliest day, hint: the days). */
function backdateError(
  error: { message: string; details?: string | null; hint?: string | null },
  t: Dictionary,
  session: Session,
): string | null {
  if (!error.message.includes("backdate_limit")) return null;
  const earliest = error.details ?? "";
  const hint = error.hint ?? "";
  return isCalendarDay(earliest) && /^\d{1,2}$/.test(hint)
    ? t.finance.backdate.tooOld(Number(hint), formatEntryDay(earliest, session.staff.locale))
    : t.finance.backdate.tooOldPlain;
}

/** Length as Postgres char_length counts it: code points, not UTF-16 units. */
const length = (value: string) => [...value].length;

/**
 * Adds one record: an expense, investor money or other income. The form sends `kind`; the table's type and category
 * come from it (categories.ts kindToRow), so a mismatched pair can never be sent. On success the page is refreshed and
 * the form clears its amount, name and comment.
 */
export async function addFinanceEntry(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireOwner();
  const { supabase, staff } = session;
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.records.errors;

  const kind = text(form, "kind");
  if (!isEntryKind(kind)) return { error: e.kind };
  const category = text(form, "category");
  const pair = kindToRow(kind, isExpenseCategory(category) ? category : null);
  if (!pair) return { error: e.category };

  const method = text(form, "payment_method");
  if (!isPaymentMethod(method)) return { error: e.method };

  // Typed as "250 000" or "250000": spaces (also no-break ones) are allowed, anything else is not.
  const amountText = text(form, "amount").replace(/[\s  ]/g, "");
  if (!/^\d+$/.test(amountText)) return { error: e.amount };
  const amount = Number(amountText);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > FINANCE_LIMITS.amountMax) {
    return { error: e.amountRange(formatSum(FINANCE_LIMITS.amountMax)) };
  }

  const date = text(form, "entry_date");
  if (!isCalendarDay(date)) return { error: e.date };
  // Read the clock only after the session (a request-time read). Days are Tashkent days, as in the database check.
  const today = tashkentDay(new Date())!;
  if (date > today) return { error: e.dateFuture };
  if (date < FINANCE_LIMITS.firstDay) return { error: e.dateTooEarly(FINANCE_LIMITS.firstDay) };

  const counterparty = text(form, "counterparty");
  if (length(counterparty) > FINANCE_LIMITS.counterpartyMax) {
    return { error: e.counterpartyLong(FINANCE_LIMITS.counterpartyMax) };
  }
  // Investor money is totalled per investor name, so a contribution without one cannot be placed.
  if (kind === "investor" && !counterparty) return { error: e.investorName };
  const note = text(form, "note");
  if (length(note) > FINANCE_LIMITS.noteMax) return { error: e.noteLong(FINANCE_LIMITS.noteMax) };
  const tooOld = await backdateRefusal(session, t, date, today);
  if (tooOld) return { error: tooOld };

  const { error } = await supabase.from("finance_entries").insert({
    entry_type: pair.entry_type,
    category: pair.category,
    entry_date: date,
    payment_method: method,
    amount,
    counterparty: counterparty || null,
    note: note || null,
  });
  if (error) {
    console.error("finance: add entry failed", error.code, error.message);
    if (isMonthClosed(error)) return { error: t.finance.monthClosedError };
    const outside = backdateError(error, t, session);
    if (outside) return { error: outside };
    // 42501: a row-level security refusal (not the owner, or a date after today in Tashkent). 23514: a check.
    if (error.code === "42501") return { error: e.denied };
    if (error.code === "23514") return { error: e.invalid };
    return { error: e.saveFailed };
  }

  refresh();
  return { ok: t.finance.records.added };
}

/** Deletes one record. A record already gone (another tab) is said so, and the page is refreshed. */
export async function deleteFinanceEntry(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.records.errors;
  const id = text(form, "id");
  if (!UUID_RE.test(id)) return { error: e.gone };

  const { data, error } = await supabase.from("finance_entries").delete().eq("id", id).select("id");
  if (error) {
    console.error("finance: delete entry failed", error.code, error.message);
    if (isMonthClosed(error)) return { error: t.finance.monthClosedError };
    // The ledger row of a purchase (migration 0022): it changes only with its receipt.
    if (error.message.includes("purchase_entry")) return { error: e.purchase };
    return { error: e.deleteFailed };
  }

  refresh();
  if (!data?.length) return { error: e.gone };
  return { ok: t.finance.records.deleted };
}

// ---------- payroll (migration 0014) ----------

type PayrollErrors = ReturnType<typeof getAdminDictionary>["finance"]["payroll"]["errors"];

/** A whole UZS amount typed as "250 000" or "250000"; an error message when it is not one in range. */
function readAmount(form: FormData, key: string, e: PayrollErrors): number | { error: string } {
  const value = text(form, key).replace(/[\s  ]/g, "");
  if (!/^\d+$/.test(value)) return { error: e.amount };
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > FINANCE_LIMITS.amountMax) {
    return { error: e.amountRange(formatSum(FINANCE_LIMITS.amountMax)) };
  }
  return amount;
}

/** A Tashkent day from the form, not before the ledger's first day and not after `latest`. */
function readDay(
  form: FormData,
  key: string,
  latest: string,
  e: PayrollErrors,
  tooLate: string = e.dateFuture,
): string | { error: string } {
  const day = text(form, key);
  if (!isCalendarDay(day)) return { error: e.date };
  if (day > latest) return { error: tooLate };
  if (day < FINANCE_LIMITS.firstDay) return { error: e.dateTooEarly(FINANCE_LIMITS.firstDay) };
  return day;
}

/** The person's employment dates, or null when there is no such person (or it is not readable). */
async function employmentOf(
  supabase: Awaited<ReturnType<typeof requireOwner>>["supabase"],
  id: string,
): Promise<{ joined_at: string; ended_at: string | null } | null> {
  const { data, error } = await supabase
    .from("finance_employees")
    .select("joined_at, ended_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`finance_employees: ${error.code} ${error.message}`);
  return data ? { joined_at: String(data.joined_at), ended_at: data.ended_at ? String(data.ended_at) : null } : null;
}

/**
 * Adds a person and their first rate, which starts on their first day: public.finance_add_employee, one transaction.
 * On success the page is refreshed and the form clears.
 */
export async function addEmployee(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.payroll.errors;

  const name = text(form, "name");
  if (!name) return { error: e.name };
  if (length(name) > PAYROLL_LIMITS.nameMax) return { error: e.nameLong(PAYROLL_LIMITS.nameMax) };
  const jobTitle = text(form, "job_title");
  if (length(jobTitle) > PAYROLL_LIMITS.jobTitleMax) return { error: e.jobTitleLong(PAYROLL_LIMITS.jobTitleMax) };

  const today = tashkentDay(new Date())!;
  const joined = readDay(form, "joined_at", today, e);
  if (typeof joined !== "string") return joined;

  const unit = text(form, "rate_unit");
  if (!isRateUnit(unit)) return { error: e.unit };
  const amount = readAmount(form, "rate_amount", e);
  if (typeof amount !== "number") return amount;

  const { error } = await supabase.rpc("finance_add_employee", {
    p_name: name,
    p_job_title: jobTitle || null,
    p_joined_at: joined,
    p_rate_amount: amount,
    p_rate_unit: unit,
  });
  if (error) {
    console.error("payroll: add employee failed", error.code, error.message);
    if (isMonthClosed(error)) return { error: t.finance.monthClosedError };
    if (error.code === DEADLOCK) return { error: t.finance.busyRetry };
    if (error.code === "42501") return { error: e.denied };
    if (error.code === "23514") return { error: e.invalid };
    return { error: e.saveFailed };
  }

  refresh();
  return { ok: t.finance.payroll.added };
}

/** A new rate from a day on (a raise, a cut, a switch between daily and monthly). One rate per person and day. */
export async function addSalaryRate(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.payroll.errors;

  const employeeId = text(form, "employee_id");
  if (!UUID_RE.test(employeeId)) return { error: e.gone };
  const today = tashkentDay(new Date())!;
  // A rate may start ahead (a raise agreed for next month), up to a year.
  const from = readDay(form, "effective_from", addDays(today, PAYROLL_LIMITS.rateAheadDays), e, e.rateTooFar);
  if (typeof from !== "string") return from;
  const unit = text(form, "rate_unit");
  if (!isRateUnit(unit)) return { error: e.unit };
  const amount = readAmount(form, "amount", e);
  if (typeof amount !== "number") return amount;
  const note = text(form, "note");
  if (length(note) > PAYROLL_LIMITS.noteMax) return { error: e.noteLong(PAYROLL_LIMITS.noteMax) };

  const { error } = await supabase.from("finance_salary_rates").insert({
    employee_id: employeeId,
    effective_from: from,
    amount,
    rate_unit: unit,
    note: note || null,
  });
  if (error) {
    console.error("payroll: add rate failed", error.code, error.message);
    if (isMonthClosed(error)) return { error: t.finance.monthClosedError };
    if (error.code === "23505") return { error: e.rateExists };
    if (error.code === "23503") return { error: e.gone };
    if (error.code === "42501") return { error: e.denied };
    if (error.code === "23514") return { error: e.invalid };
    return { error: e.saveFailed };
  }

  refresh();
  return { ok: t.finance.payroll.rateAdded };
}

/** A payment, bonus, fine or absence. A payment needs a method, a fine a reason, an absence no amount. */
export async function addSalaryEvent(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireOwner();
  const { supabase, staff } = session;
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.payroll.errors;

  const employeeId = text(form, "employee_id");
  if (!UUID_RE.test(employeeId)) return { error: e.gone };
  const kind = text(form, "kind");
  if (!isSalaryEventKind(kind)) return { error: e.kind };
  const today = tashkentDay(new Date())!;
  const date = readDay(form, "event_date", today, e);
  if (typeof date !== "string") return date;

  let amount: number | null = null;
  if (kind !== "absence") {
    const read = readAmount(form, "amount", e);
    if (typeof read !== "number") return read;
    amount = read;
  }
  const method = text(form, "payment_method");
  if (kind === "payment" && !isPaymentMethod(method)) return { error: e.method };
  const note = text(form, "note");
  if (length(note) > PAYROLL_LIMITS.noteMax) return { error: e.noteLong(PAYROLL_LIMITS.noteMax) };
  if (kind === "fine" && !note) return { error: e.fineNote };
  const tooOld = await backdateRefusal(session, t, date, today);
  if (tooOld) return { error: tooOld };

  // An absence only means something on a day of employment.
  if (kind === "absence") {
    let employment: Awaited<ReturnType<typeof employmentOf>>;
    try {
      employment = await employmentOf(supabase, employeeId);
    } catch (error) {
      console.error("payroll: read employee failed", error instanceof Error ? error.message : error);
      return { error: e.saveFailed };
    }
    if (!employment) return { error: e.gone };
    if (date < employment.joined_at || (employment.ended_at && date > employment.ended_at)) {
      return { error: e.absenceOutside };
    }
  }

  const { error } = await supabase.from("finance_salary_events").insert({
    employee_id: employeeId,
    kind,
    event_date: date,
    amount,
    payment_method: kind === "payment" ? method : null,
    note: note || null,
  });
  if (error) {
    console.error("payroll: add event failed", error.code, error.message);
    if (isMonthClosed(error)) return { error: t.finance.monthClosedError };
    const outside = backdateError(error, t, session);
    if (outside) return { error: outside };
    if (error.code === "23505") return { error: e.absentAlready };
    if (error.code === "23503") return { error: e.gone };
    if (error.code === "42501") return { error: e.denied };
    if (error.code === "23514") return { error: e.invalid };
    return { error: e.saveFailed };
  }

  refresh();
  return { ok: t.finance.payroll.eventAdded[kind] };
}

/** Records the person's last day: pay stops after it and they move to the former staff. */
export async function endEmployment(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.payroll.errors;

  const employeeId = text(form, "employee_id");
  if (!UUID_RE.test(employeeId)) return { error: e.gone };
  const today = tashkentDay(new Date())!;
  const ended = readDay(form, "ended_at", today, e);
  if (typeof ended !== "string") return ended;

  let employment: Awaited<ReturnType<typeof employmentOf>>;
  try {
    employment = await employmentOf(supabase, employeeId);
  } catch (error) {
    console.error("payroll: read employee failed", error instanceof Error ? error.message : error);
    return { error: e.saveFailed };
  }
  if (!employment) return { error: e.gone };
  if (ended < employment.joined_at) return { error: e.endBeforeStart };

  const { data, error } = await supabase
    .from("finance_employees")
    .update({ ended_at: ended, is_active: false })
    .eq("id", employeeId)
    .select("id");
  if (error) {
    console.error("payroll: end employment failed", error.code, error.message);
    if (isMonthClosed(error)) return { error: t.finance.monthClosedError };
    if (error.code === "42501") return { error: e.denied };
    if (error.code === "23514") return { error: e.invalid };
    return { error: e.saveFailed };
  }
  if (!data?.length) return { error: e.gone };

  refresh();
  return { ok: t.finance.payroll.ended };
}

/**
 * Takes back a recorded end, to fix a mistake: pay then runs on as if the person had not left. Only within
 * PAYROLL_LIMITS.resumeDays of the last working day (the database refuses later ones too, resume_too_late); a person
 * who comes back after a break is added again as a new employee, so the break is never paid.
 */
export async function resumeEmployment(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.payroll.errors;

  const employeeId = text(form, "employee_id");
  if (!UUID_RE.test(employeeId)) return { error: e.gone };

  let employment: Awaited<ReturnType<typeof employmentOf>>;
  try {
    employment = await employmentOf(supabase, employeeId);
  } catch (error) {
    console.error("payroll: read employee failed", error instanceof Error ? error.message : error);
    return { error: e.saveFailed };
  }
  if (!employment) return { error: e.gone };
  const today = tashkentDay(new Date())!;
  if (employment.ended_at && employment.ended_at < addDays(today, -PAYROLL_LIMITS.resumeDays)) {
    return { error: e.resumeTooLate(PAYROLL_LIMITS.resumeDays) };
  }

  const { data, error } = await supabase
    .from("finance_employees")
    .update({ ended_at: null, is_active: true })
    .eq("id", employeeId)
    .select("id");
  if (error) {
    console.error("payroll: resume employment failed", error.code, error.message);
    if (error.message.includes("resume_too_late")) return { error: e.resumeTooLate(PAYROLL_LIMITS.resumeDays) };
    if (isMonthClosed(error)) return { error: t.finance.monthClosedError };
    if (error.code === "42501") return { error: e.denied };
    return { error: e.saveFailed };
  }
  if (!data?.length) return { error: e.gone };

  refresh();
  return { ok: t.finance.payroll.resumed };
}

/** Deletes one payment, bonus, fine or absence. One already gone (another tab) is said so. */
export async function deleteSalaryEvent(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.payroll.errors;
  const id = text(form, "id");
  if (!UUID_RE.test(id)) return { error: e.eventGone };

  const { data, error } = await supabase.from("finance_salary_events").delete().eq("id", id).select("id");
  if (error) {
    console.error("payroll: delete event failed", error.code, error.message);
    if (isMonthClosed(error)) return { error: t.finance.monthClosedError };
    return { error: e.deleteFailed };
  }

  refresh();
  if (!data?.length) return { error: e.eventGone };
  return { ok: t.finance.payroll.deleted };
}

/**
 * Deletes one rate (a wrong one is deleted and entered again). The days it covered fall back to the rate before it,
 * or earn nothing when there is none; the page says so when a person is left without a rate.
 */
export async function deleteSalaryRate(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.payroll.errors;
  const id = text(form, "id");
  if (!UUID_RE.test(id)) return { error: e.eventGone };

  const { data, error } = await supabase.from("finance_salary_rates").delete().eq("id", id).select("id");
  if (error) {
    console.error("payroll: delete rate failed", error.code, error.message);
    if (isMonthClosed(error)) return { error: t.finance.monthClosedError };
    return { error: e.deleteFailed };
  }

  refresh();
  if (!data?.length) return { error: e.eventGone };
  return { ok: t.finance.payroll.rateDeleted };
}

// ---------- month close and settings (migration 0015) ----------

const MONTH_START_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

/** The month to close or reopen ("YYYY-MM-01"), or null. */
function readMonthStart(form: FormData): string | null {
  const month = text(form, "month_start");
  return MONTH_START_RE.test(month) ? month : null;
}

/**
 * Closes the month the form names. The database counts every figure itself (public.close_finance_month) and refuses a
 * month that has not ended, one already closed, or one out of order; each refusal is said in the owner's language.
 */
export async function closeFinanceMonth(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const c = t.finance.close;
  const e = c.errors;
  const month = readMonthStart(form);
  if (!month) return { error: e.badMonth };
  const name = formatMonth(month.slice(0, 7), staff.locale);

  const { error } = await supabase.rpc("close_finance_month", { p_month_start: month });
  if (error) {
    console.error("finance: close month failed", error.code, error.message);
    const message = error.message;
    if (message.includes("month_already_closed")) return { error: e.alreadyClosed(name) };
    if (message.includes("month_not_finished")) return { error: e.notFinished(name) };
    if (message.includes("close_out_of_order")) {
      const next = /^\d{4}-\d{2}-01$/.test(error.details ?? "") ? formatMonth(error.details.slice(0, 7), staff.locale) : null;
      return { error: next ? e.outOfOrder(next) : e.outOfOrderPlain };
    }
    if (message.includes("nothing_to_close")) return { error: e.nothingToClose };
    if (message.includes("bad_month")) return { error: e.badMonth };
    if (error.code === "42501") return { error: e.denied };
    if (error.code === DEADLOCK) return { error: t.finance.busyRetry };
    return { error: e.closeFailed };
  }

  refresh();
  return { ok: c.closedOk(name) };
}

/**
 * Opens the latest closed month again, with the reason it is reopened (at least CLOSE_LIMITS.reasonMin characters; it
 * goes to the close log). Only the latest closed month can be reopened.
 */
export async function reopenFinanceMonth(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const c = t.finance.close;
  const e = c.errors;
  const month = readMonthStart(form);
  if (!month) return { error: e.badMonth };
  const name = formatMonth(month.slice(0, 7), staff.locale);
  const reason = text(form, "reason");
  if (length(reason) < CLOSE_LIMITS.reasonMin) return { error: e.reasonShort(CLOSE_LIMITS.reasonMin) };
  if (length(reason) > CLOSE_LIMITS.reasonMax) return { error: e.reasonLong(CLOSE_LIMITS.reasonMax) };

  const { error } = await supabase.rpc("reopen_finance_month", { p_month_start: month, p_reason: reason });
  if (error) {
    console.error("finance: reopen month failed", error.code, error.message);
    const message = error.message;
    if (message.includes("reopen_not_latest")) return { error: e.notLatest };
    if (message.includes("month_not_closed")) return { error: e.notClosed(name) };
    if (message.includes("reason_required")) return { error: e.reasonShort(CLOSE_LIMITS.reasonMin) };
    if (message.includes("bad_month")) return { error: e.badMonth };
    if (error.code === "42501") return { error: e.denied };
    return { error: e.reopenFailed };
  }

  refresh();
  return { ok: c.reopenedOk(name) };
}

/**
 * Saves one finance setting (the settings screen saves each field on its own). The form sends `name` (monthlyRent,
 * breakEvenDaily or taxRatePct) and `value`; an empty value clears that setting (its row is deleted), a filled one is
 * written as a JSON number. The input rule is readFinanceSettingInput (settings.ts), the same one the field uses.
 */
export async function saveFinanceSetting(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const s = t.finance.settings;
  const e = s.errors;

  const name = text(form, "name");
  if (!isFinanceSettingName(name)) return { error: e.invalid };
  const field = s.fields[name];
  const input = readFinanceSettingInput(name, text(form, "value"));
  if ("error" in input) {
    if (input.error === "amount") return { error: e.amount(field) };
    if (input.error === "amountRange") return { error: e.amountRange(field, formatSum(FINANCE_SETTING_LIMITS.amountMax)) };
    return { error: e.tax };
  }

  const key = FINANCE_SETTING_KEYS[name];
  const { error } =
    input.value === null
      ? await supabase.from("settings").delete().eq("key", key)
      : await supabase.from("settings").upsert({ key, value: input.value }, { onConflict: "key" });
  if (error) {
    console.error("finance: save setting failed", key, error.code, error.message);
    if (error.code === "42501") return { error: e.denied };
    if (error.code === "23514") return { error: e.invalid };
    return { error: e.saveFailed };
  }

  refresh();
  return { ok: s.saved };
}

// ---------- finance analysis, round two (migration 0024) ----------

/**
 * Saves how many days back a record may be dated by hand (finance_backdate_days, 0..31). The form sends `value`; the
 * input rule is readBackdateInput (settings.ts), the same one the field uses. The database checks the value again.
 */
export async function saveBackdateDays(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const b = t.finance.backdate;
  const days = readBackdateInput(text(form, "value"));
  if (days === null) return { error: b.errors.range };

  const { error } = await supabase
    .from("settings")
    .upsert({ key: BACKDATE_SETTING_KEY, value: days }, { onConflict: "key" });
  if (error) {
    console.error("finance: save backdate days failed", error.code, error.message);
    if (error.code === "42501") return { error: b.errors.denied };
    if (error.code === "23514") return { error: b.errors.range };
    return { error: b.errors.saveFailed };
  }

  refresh();
  return { ok: t.finance.settings.saved };
}

/**
 * Adds a bank fee rate for card or transfer payments from a day on (finance_fee_rates). The form sends `method`,
 * `rate` (a percent, "1,5") and `effective_from`. One rate per method and day: a second one is refused (rateExists).
 */
export async function addFeeRate(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.fees.errors;

  const method = text(form, "method");
  if (!isFeeMethod(method)) return { error: e.method };
  const bp = readFeeRateInput(text(form, "rate"));
  if (bp === null) return { error: e.rate(FEE_LIMITS.pctMax) };
  const from = text(form, "effective_from");
  if (!isCalendarDay(from)) return { error: e.date };
  if (from < FEE_LIMITS.firstDay) return { error: e.dateTooEarly(FEE_LIMITS.firstDay) };
  // A new rate may be agreed ahead; a year is plenty.
  const today = tashkentDay(new Date())!;
  if (from > addDays(today, 366)) return { error: e.dateTooFar };

  const { error } = await supabase.from("finance_fee_rates").insert({ method, rate_bp: bp, effective_from: from });
  if (error) {
    console.error("finance: add fee rate failed", error.code, error.message);
    if (error.code === "23505") return { error: e.exists };
    if (error.code === "42501") return { error: e.denied };
    if (error.code === "23514") return { error: e.rate(FEE_LIMITS.pctMax) };
    return { error: e.saveFailed };
  }

  refresh();
  return { ok: t.finance.fees.added };
}

/** Deletes one fee rate; the days it covered fall back to the rate before it, or to none. */
export async function deleteFeeRate(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const e = t.finance.fees.errors;
  const id = text(form, "id");
  if (!UUID_RE.test(id)) return { error: e.gone };

  const { data, error } = await supabase.from("finance_fee_rates").delete().eq("id", id).select("id");
  if (error) {
    console.error("finance: delete fee rate failed", error.code, error.message);
    return { error: e.deleteFailed };
  }

  refresh();
  if (!data?.length) return { error: e.gone };
  return { ok: t.finance.fees.deleted };
}
