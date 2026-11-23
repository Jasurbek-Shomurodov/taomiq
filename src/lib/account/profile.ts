import "server-only";
import type { UserIdentity } from "@supabase/supabase-js";
import type { Locale } from "@/i18n/config";
import { createSecretClient, isOrderingConfigured } from "@/lib/supabase/secret";

const UZ_PHONE = /^\+998[0-9]{9}$/;
const NAME_MAX = 80;

type IdentityData = Record<string, unknown>;

/** A claim from the identity data, looked up at the top level and, for custom OIDC providers, under custom_claims. */
function claim(data: IdentityData, key: string): unknown {
  if (data[key] !== undefined && data[key] !== null) return data[key];
  const custom = data.custom_claims;
  if (custom && typeof custom === "object") return (custom as IdentityData)[key];
  return undefined;
}

/** Telegram sends the number without "+" (998901234567). Stored as +998…, and only when it is an Uzbek number. */
export function uzbekPhone(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const digits = String(raw).replace(/\D/g, "");
  const phone = `+${digits}`;
  return UZ_PHONE.test(phone) ? phone : null;
}

/** The numeric Telegram user id: the `id` claim, else `sub` when it is all digits. */
function telegramId(data: IdentityData, providerId: string): number | null {
  for (const value of [claim(data, "id"), claim(data, "sub"), providerId]) {
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    if (/^[0-9]{1,19}$/.test(text)) {
      const id = Number(text);
      // Telegram ids fit well inside 2^53; anything larger would lose precision on the way to bigint.
      if (Number.isSafeInteger(id) && id > 0) return id;
    }
  }
  return null;
}

function identityName(data: IdentityData): string {
  for (const key of ["full_name", "name", "given_name", "preferred_username"]) {
    const value = claim(data, key);
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, NAME_MAX);
  }
  return "";
}

/**
 * Runs on every sign-in (the OAuth callback and the email-code check), with the secret key:
 *  - makes sure the profile row exists (the sign-up trigger never fails a sign-up, so it might not);
 *  - remembers the language the customer signed in with;
 *  - fills an empty name from the provider;
 *  - from the custom:telegram identity only, stores the Telegram id and the Telegram-verified phone.
 * The identities are read from the auth server with the admin API, never from user_metadata, which the
 * customer can edit. Failures are logged and never block the sign-in.
 */
export async function syncProfile(userId: string, locale: Locale): Promise<void> {
  if (!isOrderingConfigured) {
    console.error("account: SUPABASE_SECRET_KEY is not set; profile not synced");
    return;
  }
  const admin = createSecretClient();

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !userData.user) {
    console.error("account: user read failed", userError?.message);
    return;
  }
  const identities: UserIdentity[] = userData.user.identities ?? [];
  const telegram = identities.find((identity) => identity.provider === "custom:telegram");

  const { data: existing, error: readError } = await admin
    .from("profiles")
    .select("name, phone, phone_verified")
    .eq("id", userId)
    .maybeSingle();
  if (readError) {
    console.error("account: profile read failed", readError.message);
    return;
  }

  const update: {
    locale: Locale;
    name?: string;
    telegram_id?: number;
    phone?: string;
    phone_verified?: boolean;
  } = { locale };

  if (!existing?.name) {
    const name = identities.map((identity) => identityName(identity.identity_data ?? {})).find(Boolean);
    if (name) update.name = name;
  }

  if (telegram) {
    const data = telegram.identity_data ?? {};
    const id = telegramId(data, telegram.id);
    if (id) update.telegram_id = id;
    const phone = uzbekPhone(claim(data, "phone_number"));
    if (phone) {
      update.phone = phone;
      update.phone_verified = true;
    }
  }

  const { error } = existing
    ? await admin.from("profiles").update(update).eq("id", userId)
    : await admin.from("profiles").insert({ id: userId, name: "", ...update });
  if (error) {
    console.error("account: profile sync failed", error.code, error.message);
    return;
  }

  // Only the number Telegram verified on this very sign-in. A number verified long ago may have been
  // reassigned by the carrier since, and would pull its new owner's orders onto this account.
  if (update.phone_verified && update.phone) await linkOrdersByPhone(admin, userId, update.phone);
}

/**
 * Orders placed without signing in, with the customer's Telegram-verified number, are moved onto the
 * account. Only orders that belong to no account yet; never by an unverified number or by name. The
 * caller passes only a phone_verified number. Failures are logged and never block the sign-in.
 */
async function linkOrdersByPhone(
  admin: ReturnType<typeof createSecretClient>,
  userId: string,
  phone: string,
): Promise<void> {
  if (!UZ_PHONE.test(phone)) return;
  const { error } = await admin.from("orders").update({ user_id: userId }).eq("phone", phone).is("user_id", null);
  if (error) console.error("account: order linking failed", error.code, error.message);
}
