"use server";

import { refresh, updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import { isLocale } from "@/i18n/config";
import { CATALOG_TAG } from "@/lib/data/catalog";
import { CYCLE_DAYS, SLOTS, type Slot } from "@/lib/data/types";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSessionClient } from "@/lib/supabase/server";
import { TURNSTILE_FIELD } from "@/lib/turnstile/shared";
import { recordAccessRequest } from "./access";
import { requireOwner, requireStaff } from "./auth";
import { adminGoogleCallbackUrl, isAdminGoogleLoginOn } from "./google";
import { ADMIN_LOCALE_COOKIE, ADMIN_LOCALE_COOKIE_OPTIONS, cookieLocale, rememberStaffLocale } from "./locale";
import { STAFF_NOTE_MAX, canMove, isOrderStatus } from "./orders";
import { newOrderCount } from "./queries";

export type FormState = { error?: string; ok?: string };

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const num = (form: FormData, key: string) => Number(String(form.get(key) ?? "").replace(",", "."));

// ---------- session ----------

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const t = getAdminDictionary(await cookieLocale());
  if (!isSupabaseConfigured) return { error: t.login.notConfigured };
  const supabase = await createSessionClient();
  const captchaToken = text(form, TURNSTILE_FIELD);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: text(form, "email"),
    password: String(form.get("password") ?? ""),
    // Turnstile token from the form, checked by Supabase itself once its CAPTCHA protection is on (ignored
    // until then). Not checked here as well: a token can be redeemed only once.
    options: captchaToken ? { captchaToken } : undefined,
  });
  if (error) return { error: error.code === "captcha_failed" ? t.login.captcha : t.login.wrongCredentials };

  const { data: staff, error: staffError } = await supabase
    .from("staff")
    .select("locale")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (staffError) {
    // Access cannot be confirmed: no session stays behind (same as the Google callback).
    console.error("admin: staff check after password sign-in failed", staffError.code, staffError.message);
    await supabase.auth.signOut({ scope: "local" });
    return { error: t.login.failed };
  }
  if (!staff) {
    // Not staff: recorded for the owner to approve (once per account), and no session stays behind.
    const outcome = await recordAccessRequest(data.user);
    await supabase.auth.signOut({ scope: "local" });
    redirect(outcome === "requested" ? "/login?error=requested" : "/login?error=not-staff");
  }
  await rememberStaffLocale(staff.locale);
  redirect("/");
}

/**
 * "Sign in with Google" on the back-office login. Supabase prepares the Google URL (PKCE: the code verifier goes
 * into a cookie on the admin host) and Google returns to the admin host's /auth/callback
 * (src/app/admin/auth/callback), which finishes the sign-in and checks the staff table. Google never grants access
 * by itself: a Google account with no staff row is signed out again there.
 */
export async function signInWithGoogle(): Promise<void> {
  if (!isAdminGoogleLoginOn()) redirect("/login");
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: adminGoogleCallbackUrl(), queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) {
    console.error("admin: Google sign-in start failed", error?.code, error?.message);
    redirect("/login?error=google");
  }
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * The back-office language switch. Always remembered on this device (cookie, for the login page);
 * when someone is signed in, also saved on their own staff row so it follows them to other devices.
 * The database lets a staff member update only the locale column of their own row (migration 0005).
 */
export async function setAdminLocale(form: FormData): Promise<void> {
  const locale = text(form, "locale");
  if (!isLocale(locale)) return;
  (await cookies()).set(ADMIN_LOCALE_COOKIE, locale, ADMIN_LOCALE_COOKIE_OPTIONS);

  if (isSupabaseConfigured) {
    const supabase = await createSessionClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase.from("staff").update({ locale }).eq("user_id", user.id);
      if (error) console.error("admin locale save failed", error.message);
    }
  }
  refresh();
}

/**
 * The new-orders count for the sidebar pill, read again on each client navigation (shell/NewOrdersPill.tsx), since
 * the layout itself is not re-rendered then. Owners only, checked here like requireOwner() but without redirecting:
 * it runs in the background mid-navigation, so anyone else (or no session, or a failed read) just gets null and
 * sees no pill. RLS returns no orders to anyone but the owner either way.
 */
export async function readNewOrderCount(): Promise<number | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const supabase = await createSessionClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: staff } = await supabase.from("staff").select("role").eq("user_id", user.id).maybeSingle();
    if (staff?.role !== "owner") return null;
    return await newOrderCount(supabase);
  } catch (error) {
    console.error("new order count refresh failed", error instanceof Error ? error.message : error);
    return null;
  }
}

// ---------- dishes ----------

export async function saveDish(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  const id = text(form, "id");

  const row = {
    name_ru: text(form, "name_ru"),
    name_uz: text(form, "name_uz"),
    // Optional: empty means the site converts the Latin name (src/lib/data/localized.ts).
    name_uzc: text(form, "name_uzc"),
    photo_url: text(form, "photo_url") || null,
    default_weight_g: Math.round(num(form, "default_weight_g")),
    kcal_100: num(form, "kcal_100"),
    protein_100: num(form, "protein_100"),
    fat_100: num(form, "fat_100"),
    carbs_100: num(form, "carbs_100"),
    ingredients_ru: text(form, "ingredients_ru"),
    ingredients_uz: text(form, "ingredients_uz"),
    ingredients_uzc: text(form, "ingredients_uzc"),
    allergens: form.getAll("allergens").map(String),
    verified: form.get("verified") === "on",
    active: form.get("active") === "on",
    updated_at: new Date().toISOString(),
  };

  if (!row.name_ru || !row.name_uz) return { error: t.dish.namesRequired };
  if (!(row.default_weight_g > 0)) return { error: t.dish.weightRequired };
  for (const key of ["kcal_100", "protein_100", "fat_100", "carbs_100"] as const) {
    if (!Number.isFinite(row[key]) || row[key] < 0) return { error: t.dish.nutritionNumbers };
  }

  const { error } = id
    ? await supabase.from("dishes").update(row).eq("id", id)
    : await supabase.from("dishes").insert(row);
  if (error) return { error: t.common.saveFailed(error.message) };

  updateTag(CATALOG_TAG);
  redirect("/dishes");
}

export async function deleteDish(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  const { error } = await supabase.from("dishes").delete().eq("id", text(form, "id"));
  if (error) {
    return {
      error: error.code === "23503" ? t.dish.inMenu : t.dish.deleteFailed(error.message),
    };
  }
  updateTag(CATALOG_TAG);
  redirect("/dishes");
}

// ---------- menu ----------

export type MenuRow = { slot: Slot; dish_id: string; weight_g: number };

export async function saveMenuDay(variantId: string, cycleDay: number, rows: MenuRow[]): Promise<FormState> {
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);
  if (!Number.isInteger(cycleDay) || cycleDay < 1 || cycleDay > CYCLE_DAYS) return { error: t.menu.invalidDay };

  const filled = rows.filter((r) => r.dish_id && SLOTS.includes(r.slot));
  if (filled.some((r) => !(r.weight_g > 0))) return { error: t.menu.weightEach };
  const emptySlots = SLOTS.filter((slot) => !filled.some((r) => r.slot === slot));

  if (filled.length > 0) {
    const { error } = await supabase.from("menu_items").upsert(
      filled.map((r) => ({
        variant_id: variantId,
        cycle_day: cycleDay,
        slot: r.slot,
        dish_id: r.dish_id,
        weight_g: Math.round(r.weight_g),
      })),
      { onConflict: "variant_id,cycle_day,slot" },
    );
    if (error) return { error: t.common.saveFailed(error.message) };
  }
  if (emptySlots.length > 0) {
    const { error } = await supabase
      .from("menu_items")
      .delete()
      .eq("variant_id", variantId)
      .eq("cycle_day", cycleDay)
      .in("slot", emptySlots);
    if (error) return { error: t.common.saveFailed(error.message) };
  }

  updateTag(CATALOG_TAG);
  return { ok: t.menu.daySaved(cycleDay) };
}

/**
 * Copy a menu from another calorie level (one day, or all 30 when day is null).
 * Portion weights are scaled by the calorie ratio and rounded to 10 g.
 * Existing entries in the target are overwritten.
 */
export async function copyMenuFromVariant(
  targetVariantId: string,
  sourceVariantId: string,
  day: number | null,
): Promise<FormState> {
  const { supabase, staff } = await requireStaff();
  const t = getAdminDictionary(staff.locale);

  const { data: variants, error: variantsError } = await supabase
    .from("program_variants")
    .select("id, kcal")
    .in("id", [targetVariantId, sourceVariantId]);
  const target = variants?.find((v) => v.id === targetVariantId);
  const source = variants?.find((v) => v.id === sourceVariantId);
  if (variantsError || !target || !source) return { error: t.menu.variantNotFound };

  let query = supabase.from("menu_items").select("cycle_day, slot, dish_id, weight_g").eq("variant_id", sourceVariantId);
  if (day) query = query.eq("cycle_day", day);
  const { data: items, error } = await query;
  if (error) return { error: t.common.failed(error.message) };
  if (!items?.length) return { error: t.menu.sourceEmpty };

  const scale = target.kcal / source.kcal;
  const { error: writeError } = await supabase.from("menu_items").upsert(
    items.map((item) => ({
      variant_id: targetVariantId,
      cycle_day: item.cycle_day,
      slot: item.slot,
      dish_id: item.dish_id,
      weight_g: Math.max(10, Math.round((item.weight_g * scale) / 10) * 10),
    })),
    { onConflict: "variant_id,cycle_day,slot" },
  );
  if (writeError) return { error: t.common.saveFailed(writeError.message) };

  updateTag(CATALOG_TAG);
  return { ok: t.menu.copied(items.length) };
}

// ---------- programs and prices ----------

export async function saveProgram(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const id = text(form, "id");

  const { error } = await supabase
    .from("programs")
    .update({
      tagline_ru: text(form, "tagline_ru"),
      tagline_uz: text(form, "tagline_uz"),
      description_ru: text(form, "description_ru"),
      description_uz: text(form, "description_uz"),
      // Optional: empty means the site converts the Latin text (src/lib/data/localized.ts).
      tagline_uzc: text(form, "tagline_uzc"),
      description_uzc: text(form, "description_uzc"),
      active: form.get("active") === "on",
    })
    .eq("id", id);
  if (error) return { error: t.common.saveFailed(error.message) };

  for (const variantId of form.getAll("variant_id").map(String)) {
    const price = Math.round(num(form, `price_${variantId}`));
    const meals = Math.round(num(form, `meals_${variantId}`));
    if (!(price >= 0) || !(meals >= 1)) return { error: t.programs.priceMeals };
    const { error: variantError } = await supabase
      .from("program_variants")
      .update({ price_per_day: price, meals_per_day: meals, active: form.get(`active_${variantId}`) === "on" })
      .eq("id", variantId);
    if (variantError) return { error: t.common.saveFailed(variantError.message) };
  }

  updateTag(CATALOG_TAG);
  return { ok: t.common.saved };
}

export async function saveDurations(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  for (const days of form.getAll("days").map(Number)) {
    const markup = num(form, `markup_${days}`);
    if (!Number.isFinite(markup)) return { error: t.programs.markupNumber };
    const { error } = await supabase.from("durations").update({ markup_pct: markup }).eq("days", days);
    if (error) return { error: t.common.saveFailed(error.message) };
  }
  updateTag(CATALOG_TAG);
  return { ok: t.common.saved };
}

// ---------- orders (owner only) ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Moves an order one step along new → confirmed → paid → active → completed, or cancels an open one.
 * The update only applies if the order is still in the status the page showed, so a stale tab or a
 * double click never skips a step.
 */
export async function setOrderStatus(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const id = text(form, "id");
  const from = text(form, "from");
  const to = text(form, "to");
  if (!UUID_RE.test(id) || !isOrderStatus(from) || !isOrderStatus(to) || !canMove(from, to)) {
    return { error: t.order.badTransition };
  }

  const { data, error } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", id)
    .eq("status", from)
    .select("id");
  if (error) {
    // check_order_status() in the database enforces the same rule as canMove().
    if (error.message.includes("invalid_transition")) return { error: t.order.badTransition };
    return { error: t.common.saveFailed(error.message) };
  }

  refresh();
  if (!data?.length) return { error: t.order.statusChanged };
  return { ok: t.order.statusSet(t.orders.statuses[to]) };
}

export async function saveOrderNote(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale);
  const id = text(form, "id");
  const note = text(form, "staff_note");
  if (!UUID_RE.test(id)) return { error: t.order.notFound };
  if (note.length > STAFF_NOTE_MAX) return { error: t.order.noteTooLong(STAFF_NOTE_MAX) };

  const { data, error } = await supabase.from("orders").update({ staff_note: note }).eq("id", id).select("id");
  if (error) return { error: t.common.saveFailed(error.message) };
  if (!data?.length) return { error: t.order.notFound };

  refresh();
  return { ok: t.order.noteSaved };
}
