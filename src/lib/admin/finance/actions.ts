"use server";

import { refresh } from "next/cache";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum } from "@/i18n/config";
import type { FormState } from "../actions";
import { requireOwner } from "../auth";
import { tashkentDay } from "../stats";
import {
  FINANCE_LIMITS,
  isEntryKind,
  isExpenseCategory,
  isPaymentMethod,
  kindToRow,
} from "./categories";
import { isCalendarDay } from "./month";

/*
 * Finance ledger writes (migration 0013), owner only. Each action checks the owner first (requireOwner redirects
 * anyone else), then validates everything the table checks again, so a refusal from the database is the exception.
 * Database errors are logged with their code and shown as a sentence in the owner's language, never raw.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
/** Length as Postgres char_length counts it: code points, not UTF-16 units. */
const length = (value: string) => [...value].length;

/**
 * Adds one record: an expense, investor money or other income. The form sends `kind`; the table's type and category
 * come from it (categories.ts kindToRow), so a mismatched pair can never be sent. On success the page is refreshed and
 * the form clears its amount, name and comment.
 */
export async function addFinanceEntry(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
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
    return { error: e.deleteFailed };
  }

  refresh();
  if (!data?.length) return { error: e.gone };
  return { ok: t.finance.records.deleted };
}
