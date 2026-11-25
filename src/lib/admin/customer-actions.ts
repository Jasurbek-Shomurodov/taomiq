"use server";

import { refresh } from "next/cache";
import { getAdminDictionary } from "@/i18n/admin";
import type { FormState } from "./actions";
import { requireOrdersAccess } from "./auth";
import { CUSTOMER_CHANGED, CUSTOMER_NOTE_MAX, parseCustomerKey } from "./customers";

/*
 * The staff note on a customer page (docs/plans/zarkebab-feature-port.md, slice 4). Owners and managers only
 * (requireOrdersAccess; public.set_customer_note of migration 0020 checks the role again and is the only way a note is
 * written: client roles cannot write public.customer_notes). The form posts the customer's key and the phone the page
 * was rendered with (in the POST body, never the address); the function refuses the save when the key's order now has
 * another phone, so a page opened before a phone edit never writes onto someone else. Errors are logged with their
 * code only (the rows hold personal data).
 */

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function saveCustomerNote(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOrdersAccess();
  const t = getAdminDictionary(staff.locale);
  const c = t.customers;
  const key = parseCustomerKey(text(form, "key"));
  const phone = text(form, "phone");
  const note = text(form, "note");
  if (!key || !phone) return { error: c.notFound };
  if (note.length > CUSTOMER_NOTE_MAX) return { error: c.noteTooLong(CUSTOMER_NOTE_MAX) };

  const { error } = await supabase.rpc("set_customer_note", { p_key: key, p_expected_phone: phone, p_note: note });
  if (error) {
    console.error("customer note: save failed", error.code);
    if (error.message.includes(CUSTOMER_CHANGED)) return { error: c.changed };
    if (error.code === "P0002") return { error: c.notFound };
    if (error.code === "22001") return { error: c.noteTooLong(CUSTOMER_NOTE_MAX) };
    return { error: t.common.saveFailed(error.message) };
  }

  refresh();
  return { ok: c.noteSaved };
}
