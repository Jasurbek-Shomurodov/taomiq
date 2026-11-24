import type { Metadata } from "next";
import { Lockup } from "@/components/Logo";
import { getAdminDictionary } from "@/i18n/admin";
import { isAdminGoogleLoginOn } from "@/lib/admin/google";
import { cookieLocale } from "@/lib/admin/locale";
import { turnstileWidgetKey } from "@/lib/turnstile/config";
import { AuthCard, AuthShell } from "../AuthShell";
import { LoginForm } from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getAdminDictionary(await cookieLocale()).login.title };
}

/** No session yet: the language comes from the admin_locale cookie (Russian by default). */
async function Login() {
  const locale = await cookieLocale();
  const t = getAdminDictionary(locale);
  return (
    <AuthCard locale={locale}>
      <div className="flex flex-col items-center text-center">
        <Lockup onDark={false} width={132} />
        <h1 className="mt-8 font-serif text-3xl text-forest">{t.login.heading}</h1>
        <p className="label mt-3 text-muted">{t.login.panel}</p>
      </div>
      <LoginForm locale={locale} turnstileKey={turnstileWidgetKey} google={isAdminGoogleLoginOn()} />
    </AuthCard>
  );
}

export default function LoginPage() {
  // The placeholder matches the card (measured at 360 px and desktop): the Google button and divider add ~7 rem.
  const placeholder = isAdminGoogleLoginOn() ? "h-[44rem] sm:h-[42.75rem]" : "h-[36.75rem] sm:h-[35.5rem]";
  return (
    <AuthShell placeholderClassName={placeholder}>
      <Login />
    </AuthShell>
  );
}
