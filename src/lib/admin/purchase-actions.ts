"use server";

import { redirect } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import type { FormState } from "./actions";
import { requireStockAccess } from "./auth";
import {
  PURCHASE_BACKDATE_DAYS,
  checkPurchase,
  hasPurchaseErrors,
  isPurchaseDayAllowed,
  readLinesField,
  type LineProblem,
  type PurchaseErrors,
} from "./purchases";
import { tashkentDay } from "./stats";

/*
 * Purchase writes (docs/plans/zarkebab-feature-port.md, slice 6), owners and managers (requireStockAccess; the
 * database functions check the role again). A receipt and its one ledger row are written together by
 * public.purchase_save and removed together by public.purchase_delete (migration 0022); nothing here touches
 * finance_entries. Database errors are logged with their code only and shown as a sentence in the staff member's
 * language.
 */

/** `saved`: a new receipt was saved (the form clears its lines and makes a new request id). */
export type PurchaseFormState = { errors?: PurchaseErrors; error?: string; saved?: { id: string; total: number } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/** The error code of a purchase function, from the message it raised. */
function code(error: { message: string }): string {
  return error.message.trim().split(/\s/)[0] ?? "";
}

/**
 * Saves a receipt: a new one (no id) or an edit (id, plus the updated_at and the day it was loaded with). The form
 * sends a request id that stays the same for a repeated send, so a double tap saves one receipt. On success: a new
 * receipt answers `saved` (the form stays mounted, clears its lines and takes a new request id); an edit goes back to
 * the receipt.
 */
export async function savePurchase(_prev: PurchaseFormState, form: FormData): Promise<PurchaseFormState> {
  const { supabase, staff } = await requireStockAccess();
  const t = getAdminDictionary(staff.locale).purchases;
  const today = tashkentDay(new Date())!;

  const id = text(form, "id");
  const requestId = text(form, "request_id");
  const loadedAt = text(form, "loaded_at");
  const loadedDay = text(form, "loaded_day");
  const day = text(form, "day");
  const buyerId = text(form, "buyer_id");
  const method = text(form, "payment_method");
  const note = text(form, "note");
  const drafts = readLinesField(String(form.get("lines") ?? ""));

  if ((id && !UUID_RE.test(id)) || !UUID_RE.test(requestId) || (buyerId && !UUID_RE.test(buyerId)) || !drafts) {
    return { error: t.errors.failed };
  }
  if (id && !loadedAt) return { error: t.errors.stale };

  // An edit may keep the day it has; a new or changed day is today or up to 3 days back.
  const dayAllowed = DAY_RE.test(day) && ((id !== "" && day === loadedDay) || isPurchaseDayAllowed(day, today));
  const { errors, payload } = checkPurchase({ dayAllowed, method, note, lines: drafts });
  if (hasPurchaseErrors(errors)) return { errors };

  // Positions in the payload (blank rows left out) → positions in the form, for a line the database names.
  const formIndex = drafts
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.ingredientId || line.quantity.trim() || line.amount.trim())
    .map(({ index }) => index);

  const { data, error } = await supabase.rpc("purchase_save", {
    p_request_id: requestId,
    p_id: id || null,
    p_day: day,
    p_buyer_id: buyerId || null,
    p_method: method,
    p_note: note,
    p_lines: payload,
    p_loaded_at: id ? loadedAt : null,
  });
  if (error) {
    const c = code(error);
    const position = Number(error.details);
    const lineAt = Number.isSafeInteger(position) && position >= 1 ? formIndex[position - 1] : undefined;
    const lineError = (problem: LineProblem): PurchaseFormState =>
      lineAt === undefined ? { error: t.errors.failed } : { errors: { form: [], lines: { [lineAt]: [problem] } } };
    switch (c) {
      case "stale":
        return { error: t.errors.stale };
      case "too_old":
        return { error: t.errors.tooOld(PURCHASE_BACKDATE_DAYS) };
      case "not_found":
        return { error: t.errors.notFound };
      case "month_closed":
        return { error: t.errors.monthClosed };
      case "purchase_day":
        return { errors: { form: ["day"], lines: {} } };
      case "invalid_method":
        return { errors: { form: ["method"], lines: {} } };
      case "note_too_long":
        return { errors: { form: ["note"], lines: {} } };
      case "no_lines":
      case "too_many_lines":
        return { errors: { form: ["lines"], lines: {} } };
      case "total_too_large":
        return { errors: { form: ["total"], lines: {} } };
      case "invalid_buyer":
        return { error: t.errors.buyer };
      case "ingredient_archived":
        return lineAt === undefined ? { error: t.errors.archived } : { error: t.errors.archived, ...lineError("ingredient") };
      case "invalid_ingredient":
      case "invalid_line":
        return lineError("ingredient");
      case "invalid_quantity":
        return lineError("quantity");
      case "invalid_amount":
        return lineError("amount");
    }
    console.error("purchases: purchase_save failed", error.code, c);
    if (error.code === "42501") return { error: t.errors.notAllowed };
    return { error: t.errors.failed };
  }

  const answer = (data ?? {}) as { id?: unknown; total?: unknown };
  const savedId = answer.id;
  if (typeof savedId !== "string" || !UUID_RE.test(savedId)) redirect("/purchases?tab=history");
  if (id) redirect(`/purchases/${savedId}?saved=1`);
  const total = Number(answer.total);
  return { saved: { id: savedId, total: Number.isFinite(total) ? total : 0 } };
}

/** Deletes a receipt and its ledger row (asked first on the page). Then the History. */
export async function deletePurchase(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireStockAccess();
  const t = getAdminDictionary(staff.locale).purchases;
  const id = text(form, "id");
  const loadedAt = text(form, "loaded_at");
  if (!UUID_RE.test(id)) return { error: t.errors.notFound };

  const { error } = await supabase.rpc("purchase_delete", { p_id: id, p_loaded_at: loadedAt || null });
  if (error) {
    const c = code(error);
    if (c === "stale") return { error: t.errors.stale };
    if (c === "too_old") return { error: t.errors.tooOld(PURCHASE_BACKDATE_DAYS) };
    if (c === "month_closed") return { error: t.errors.monthClosed };
    console.error("purchases: purchase_delete failed", error.code, c);
    if (error.code === "42501") return { error: t.errors.notAllowed };
    return { error: t.errors.deleteFailed };
  }
  // Gone already (deleted in another tab) ends the same way: the receipt is not there.
  redirect("/purchases?tab=history&deleted=1");
}
