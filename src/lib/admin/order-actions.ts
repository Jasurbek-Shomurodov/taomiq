"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { isLocale } from "@/i18n/config";
import type { FormState } from "./actions";
import { requireOrdersAccess } from "./auth";
import {
  checkContact,
  checkNote,
  checkSchedule,
  dbFieldError,
  hasErrors,
  staffPhone,
  type StaffOrderContact,
  type StaffOrderErrors,
  type StaffOrderSchedule,
} from "./order-form";
import { ORDER_STATUSES, canChangePaymentMethod, isPaymentMethod } from "./orders";
import { tashkentDay } from "./stats";

/*
 * Order operations of the back office (docs/plans/zarkebab-feature-port.md, slice 2), owners and managers only
 * (requireOrdersAccess redirects anyone else; the database functions check the role again). The status moves
 * (with the payment method and the cancel reason) stay in actions.ts beside the note. Database errors are logged with
 * their code only (the rows hold personal data) and shown as a sentence in the staff member's language.
 */

export type StaffOrderState = { fields?: StaffOrderErrors; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function readContact(form: FormData): StaffOrderContact {
  return {
    name: text(form, "name"),
    // "" when it is not exactly an Uzbek number: refused below as a phone problem, never truncated.
    phone: staffPhone(text(form, "phone")) ?? "",
    address: text(form, "address"),
    window: text(form, "window"),
    comment: text(form, "comment"),
    exclusions: text(form, "exclusions"),
  };
}

function readSchedule(form: FormData): StaffOrderSchedule {
  return { startDate: text(form, "start_date"), weekdaysOnly: text(form, "schedule") === "weekdays" };
}

/**
 * Contact checks without the window list: the database checks the window against the settings as they are now (they
 * may have changed since the form loaded); here only an empty window is refused.
 */
function checkContactShape(contact: StaffOrderContact): StaffOrderErrors {
  return checkContact(contact, [], contact.window || undefined);
}

/**
 * Adds an order by hand: an owner or manager takes it by phone or Telegram. The database prices it with the site's
 * rule and marks it confirmed and added by the caller. On success: the new order's page.
 */
export async function createOrder(_prev: StaffOrderState, form: FormData): Promise<StaffOrderState> {
  const { supabase, staff } = await requireOrdersAccess();
  const t = getAdminDictionary(staff.locale).orderForm;
  const today = tashkentDay(new Date())!;

  const variantId = text(form, "variant_id");
  const days = Number(text(form, "days"));
  const contact = readContact(form);
  const schedule = readSchedule(form);
  const note = text(form, "staff_note");
  const locale = text(form, "locale");

  const fields: StaffOrderErrors = {
    ...(UUID_RE.test(variantId) ? {} : { plan: "invalid" }),
    ...(Number.isSafeInteger(days) && days > 0 ? {} : { duration: "invalid" }),
    ...checkSchedule(schedule, today),
    ...checkContactShape(contact),
    ...checkNote(note),
  };
  if (hasErrors(fields)) return { fields };
  if (!isLocale(locale)) return { error: t.errors.failed };

  const { data, error } = await supabase.rpc("staff_create_order", {
    p_variant_id: variantId,
    p_days: days,
    p_weekdays_only: schedule.weekdaysOnly,
    p_start_date: schedule.startDate,
    p_name: contact.name,
    p_phone: contact.phone,
    p_address: contact.address,
    p_window: contact.window,
    p_comment: contact.comment,
    p_exclusions: contact.exclusions,
    p_staff_note: note,
    p_locale: locale,
  });
  if (error) {
    const field = dbFieldError(error.message);
    if (field) return { fields: field };
    console.error("orders: staff_create_order failed", error.code);
    if (error.code === "42501") return { error: t.errors.notAllowed };
    return { error: t.errors.failed };
  }

  const id = (data as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    // Saved, but the answer is not readable: the list shows it.
    redirect("/orders");
  }
  redirect(`/orders/${id}`);
}

/**
 * Saves an edit of an open order's contact and delivery fields, and of its schedule while it has not started. The form
 * sends the updated_at it was loaded with: if someone changed the order since, nothing is written (stale).
 */
export async function editOrder(_prev: StaffOrderState, form: FormData): Promise<StaffOrderState> {
  const { supabase, staff } = await requireOrdersAccess();
  const t = getAdminDictionary(staff.locale).orderForm;
  const today = tashkentDay(new Date())!;

  const id = text(form, "id");
  const loadedAt = text(form, "loaded_at");
  if (!UUID_RE.test(id) || !loadedAt) return { error: t.errors.failed };

  const contact = readContact(form);
  const schedule = readSchedule(form);
  // The schedule the form was loaded with: an unchanged one is not checked against today (the order may have started).
  const scheduleChanged =
    schedule.startDate !== text(form, "loaded_start_date") ||
    (schedule.weekdaysOnly ? "weekdays" : "daily") !== text(form, "loaded_schedule");
  const fields: StaffOrderErrors = {
    ...checkContactShape(contact),
    ...(scheduleChanged ? checkSchedule(schedule, today) : {}),
  };
  if (hasErrors(fields)) return { fields };

  const { error } = await supabase.rpc("staff_edit_order", {
    p_id: id,
    p_loaded_at: loadedAt,
    p_name: contact.name,
    p_phone: contact.phone,
    p_address: contact.address,
    p_window: contact.window,
    p_comment: contact.comment,
    p_exclusions: contact.exclusions,
    p_start_date: schedule.startDate,
    p_weekdays_only: schedule.weekdaysOnly,
  });
  if (error) {
    const message = error.message;
    if (message.includes("stale")) return { error: t.errors.stale };
    if (message.includes("schedule_locked")) return { error: t.errors.scheduleLocked };
    if (message.includes("not_editable")) return { error: t.errors.notEditable };
    if (message.includes("not_found")) return { error: t.errors.notFound };
    const field = dbFieldError(message);
    if (field) return { fields: field };
    console.error("orders: staff_edit_order failed", error.code);
    if (error.code === "42501") return { error: t.errors.notAllowed };
    return { error: t.errors.failed };
  }

  redirect(`/orders/${id}`);
}

/**
 * Sets or changes how a paid order was paid. Applies only while the order is still paid, delivering or completed and
 * still has the method the page showed (`from`, empty for none), so a stale tab never overwrites another change. The
 * change is recorded in the order's history by the database.
 */
export async function changePaymentMethod(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOrdersAccess();
  const t = getAdminDictionary(staff.locale).order;
  const id = text(form, "id");
  const from = text(form, "from");
  const to = text(form, "payment_method");
  if (!UUID_RE.test(id)) return { error: t.notFound };
  if (!isPaymentMethod(to)) return { error: t.methodRequired };
  if (from === to) return { ok: t.methodSaved };
  if (from !== "" && !isPaymentMethod(from)) return { error: t.statusChanged };

  let query = supabase
    .from("orders")
    .update({ payment_method: to })
    .eq("id", id)
    .in("status", ORDER_STATUSES.filter(canChangePaymentMethod));
  query = from ? query.eq("payment_method", from) : query.is("payment_method", null);
  const { data, error } = await query.select("id");
  if (error) {
    console.error("orders: payment method change failed", error.code);
    if (error.message.includes("payment_method_not_paid")) return { error: t.methodNotPaid };
    return { error: getAdminDictionary(staff.locale).common.saveFailed(error.code || "—") };
  }

  refresh();
  if (!data?.length) return { error: t.statusChanged };
  return { ok: t.methodSaved };
}
