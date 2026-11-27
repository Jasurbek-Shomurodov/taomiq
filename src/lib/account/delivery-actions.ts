"use server";

import { refresh } from "next/cache";
import { getDictionary } from "@/i18n";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { getOrderSettings } from "@/lib/data/catalog";
import { DEFAULT_DELIVERY_WINDOWS, LIMITS } from "@/lib/order/rules";
import { getCustomer } from "./auth";
import { saveDelivery, type SaveDeliveryError } from "./delivery";

/*
 * The "Delivery details" card in the account (docs/plans/saved-address-repeat-order.md, slice 3): change or remove the
 * saved address, delivery time and courier note. The database checks them again (public.save_my_delivery, 0030) and
 * writes only the caller's own profile.
 */

export type DeliveryState = { ok?: string; error?: string; field?: "address" | "window" | "note" };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const localeFrom = (value: unknown): Locale => (typeof value === "string" && isLocale(value) ? value : defaultLocale);

async function deliveryWindows(): Promise<string[]> {
  try {
    return (await getOrderSettings()).deliveryWindows;
  } catch {
    return DEFAULT_DELIVERY_WINDOWS;
  }
}

function stateOf(locale: Locale, error: SaveDeliveryError): DeliveryState {
  const e = getDictionary(locale).account.delivery.errors;
  switch (error) {
    case "invalid_address":
      return { error: e.address, field: "address" };
    case "invalid_window":
      return { error: e.window, field: "window" };
    case "too_long":
      return { error: e.tooLong, field: "note" };
    case "not_allowed":
      return { error: e.signIn };
    default:
      return { error: e.failed };
  }
}

/** Saves the card's address (required), delivery time (optional) and courier note (optional). */
export async function saveMyDelivery(_prev: DeliveryState, form: FormData): Promise<DeliveryState> {
  const locale = localeFrom(form.get("locale"));
  const d = getDictionary(locale).account.delivery;
  if (!(await getCustomer())) return { error: d.errors.signIn };

  const address = text(form, "address");
  const deliveryWindow = text(form, "window");
  const note = text(form, "note");
  if (address.length < LIMITS.address.min || address.length > LIMITS.address.max) return stateOf(locale, "invalid_address");
  if (deliveryWindow && !(await deliveryWindows()).includes(deliveryWindow)) return stateOf(locale, "invalid_window");
  if (note.length > LIMITS.comment) return stateOf(locale, "too_long");

  const error = await saveDelivery({ address, window: deliveryWindow, note });
  if (error) return stateOf(locale, error);
  refresh();
  return { ok: d.saved };
}

/** Removes the saved address, delivery time and courier note. Orders already placed keep theirs. */
export async function removeMyDelivery(_prev: DeliveryState, form: FormData): Promise<DeliveryState> {
  const locale = localeFrom(form.get("locale"));
  const d = getDictionary(locale).account.delivery;
  if (!(await getCustomer())) return { error: d.errors.signIn };

  const error = await saveDelivery(null);
  if (error) return stateOf(locale, error);
  refresh();
  return { ok: d.removed };
}
