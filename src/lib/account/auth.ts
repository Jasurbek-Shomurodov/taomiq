import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Locale } from "@/i18n/config";
import { createSessionClient } from "@/lib/supabase/server";
import { isAccountEnabled, safeNext, type AuthMethod } from "./methods";

export type Profile = {
  name: string;
  phone: string | null;
  phone_verified: boolean;
  locale: string;
};

export type Customer = {
  id: string;
  email: string;
  /** Linked sign-in methods, from the auth server's identities (not from user-editable metadata). */
  methods: AuthMethod[];
  /** Null only if the profile row is missing (the sign-up trigger failed and the callback could not repair it). */
  profile: Profile | null;
};

/** Supabase identity provider → our method name. */
const PROVIDER_METHOD: Record<string, AuthMethod> = {
  "custom:telegram": "telegram",
  google: "google",
  email: "email",
};

/**
 * The signed-in customer, or null. Verifies the session with the auth server (getUser), then reads the
 * customer's own profile row through RLS. Memoised per server render (React cache).
 * Reads cookies: call it only inside a <Suspense> boundary, in a server action or a route handler.
 */
export const getCustomer = cache(async (): Promise<Customer | null> => {
  if (!isAccountEnabled) return null;

  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("name, phone, phone_verified, locale")
    .eq("id", user.id)
    .maybeSingle();
  if (error) console.error("account: profile read failed", error.message);

  const methods = [
    ...new Set((user.identities ?? []).map((identity) => PROVIDER_METHOD[identity.provider]).filter(Boolean)),
  ];

  return { id: user.id, email: user.email ?? "", methods, profile: profile ?? null };
});

/** The signed-in customer, or a redirect to the login page that comes back to `next` afterwards. */
export async function requireCustomer(locale: Locale, next = `/${locale}/account`): Promise<Customer> {
  const customer = await getCustomer();
  if (!customer) redirect(`/${locale}/login?next=${encodeURIComponent(safeNext(next, locale))}`);
  return customer;
}
