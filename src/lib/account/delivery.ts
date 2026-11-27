import "server-only";
import { createSessionClient } from "@/lib/supabase/server";
import { isAccountEnabled } from "./methods";

/*
 * The signed-in customer's saved delivery details and the repeat read (migration 0030;
 * docs/plans/saved-address-repeat-order.md). Everything goes through the customer's own session: the profile row through
 * RLS ("customer reads own profile", 0006), the writes through public.save_my_delivery and the repeat through
 * public.my_order_for_repeat, which return or change only the caller's own rows. Errors are logged with their code only,
 * never with the address.
 */

/** Saved on the customer's profile. "" for a field that is not saved. */
export type SavedDelivery = { address: string; window: string; note: string };

/** The saved details; null when nothing is saved; "failed" when they could not be read. */
export type SavedDeliveryRead = SavedDelivery | null | "failed";

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The saved details of the signed-in customer `userId`. Reads cookies: request time only. */
export async function readSavedDelivery(userId: string): Promise<SavedDeliveryRead> {
  if (!isAccountEnabled) return null;
  try {
    const supabase = await createSessionClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("address, delivery_window, courier_note")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.error("account: saved delivery read failed", error.code);
      return "failed";
    }
    const saved = { address: str(data?.address), window: str(data?.delivery_window), note: str(data?.courier_note) };
    return saved.address || saved.window || saved.note ? saved : null;
  } catch (error) {
    console.error("account: saved delivery read failed", error instanceof Error ? error.name : "unknown");
    return "failed";
  }
}

/** Database error codes of save_my_delivery that the forms show as a sentence of their own. */
export type SaveDeliveryError = "invalid_address" | "invalid_window" | "too_long" | "not_allowed" | "failed";

/**
 * Saves (or, with every field empty, clears) the signed-in customer's delivery details. Never throws. An order must
 * never wait long on this: after 2.5 s it gives up with "failed" (the call may still finish on the database).
 */
export async function saveDelivery(details: SavedDelivery | null): Promise<SaveDeliveryError | null> {
  if (!isAccountEnabled) return "failed";
  try {
    const supabase = await createSessionClient();
    const call = supabase.rpc("save_my_delivery", {
      p_address: details?.address || null,
      p_window: details?.window || null,
      p_note: details?.note || null,
    });
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2500));
    const result = await Promise.race([call, timeout]);
    if (result === "timeout") {
      console.error("account: save_my_delivery timed out");
      return "failed";
    }
    const { error } = result;
    if (!error) return null;
    const known = (["invalid_address", "invalid_window", "too_long", "not_allowed"] as const).find((code) =>
      error.message.includes(code),
    );
    if (known) return known;
    if (error.code === "42501") return "not_allowed";
    console.error("account: save_my_delivery failed", error.code);
    return "failed";
  } catch (error) {
    console.error("account: save_my_delivery failed", error instanceof Error ? error.name : "unknown");
    return "failed";
  }
}

/** One order of the customer's own, as public.my_order_for_repeat returns it. */
export type RepeatOrder = {
  variantId: string;
  /** The order's program, "" when its level no longer belongs to one. */
  programSlug: string;
  kcal: number;
  days: number;
  weekdaysOnly: boolean;
  address: string;
  window: string;
  comment: string;
  exclusions: string;
};

/** The signed-in customer's order `number` for the order form; null when it is not theirs or not there; "failed". */
export async function readRepeatOrder(number: number): Promise<RepeatOrder | null | "failed"> {
  if (!isAccountEnabled) return null;
  try {
    const supabase = await createSessionClient();
    const { data, error } = await supabase.rpc("my_order_for_repeat", { p_number: number });
    if (error) {
      console.error("account: my_order_for_repeat failed", error.code);
      return "failed";
    }
    const row: unknown = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    const kcal = Number(r.kcal);
    const days = Number(r.days);
    if (!str(r.variant_id) || !Number.isInteger(kcal) || !Number.isInteger(days)) return null;
    return {
      variantId: str(r.variant_id),
      programSlug: str(r.program_slug),
      kcal,
      days,
      weekdaysOnly: r.weekdays_only === true,
      address: str(r.address),
      window: str(r.delivery_window),
      comment: str(r.comment),
      exclusions: str(r.exclusions),
    };
  } catch (error) {
    console.error("account: my_order_for_repeat failed", error instanceof Error ? error.name : "unknown");
    return "failed";
  }
}
