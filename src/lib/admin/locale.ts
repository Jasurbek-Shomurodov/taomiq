import "server-only";
import { cookies } from "next/headers";
import { isLocale, type Locale } from "@/i18n/config";
import { defaultAdminLocale } from "@/i18n/admin";

/**
 * The back-office language. Signed in, it is staff.locale (it follows the person across devices; see
 * requireStaff()). Before sign-in (login and setup pages) it comes from this cookie, which the language
 * switch and a successful sign-in keep equal to the person's choice on this device.
 */
export const ADMIN_LOCALE_COOKIE = "admin_locale";

export const ADMIN_LOCALE_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
} as const;

export async function cookieLocale(): Promise<Locale> {
  const value = (await cookies()).get(ADMIN_LOCALE_COOKIE)?.value ?? "";
  return isLocale(value) ? value : defaultAdminLocale;
}
