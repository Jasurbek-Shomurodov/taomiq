import type { Metadata } from "next";
import { Suspense } from "react";
import { Lockup } from "@/components/Logo";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { cookieLocale } from "@/lib/admin/locale";
import { turnstileWidgetKey } from "@/lib/turnstile/config";
import { LanguageSwitch } from "../LanguageSwitch";
import { LoginForm } from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getAdminDictionary(await cookieLocale()).login.title };
}

/** No session yet: the language comes from the admin_locale cookie (Russian by default). */
async function Login() {
  const locale = await cookieLocale();
  const t = getAdminDictionary(locale);
  return (
    <div lang={htmlLang[locale]} className="w-full max-w-sm rounded-3xl bg-ivory p-8">
      <div className="flex justify-end">
        <LanguageSwitch locale={locale} label={t.switcher.label} onLight />
      </div>
      <div className="mt-2 flex flex-col items-center text-center">
        <Lockup onDark={false} width={132} />
        <p className="label mt-4 text-muted">{t.login.panel}</p>
      </div>
      <LoginForm locale={locale} turnstileKey={turnstileWidgetKey} />
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-forest p-5">
      <Suspense fallback={<div className="h-96 w-full max-w-sm rounded-3xl bg-ivory" />}>
        <Login />
      </Suspense>
    </main>
  );
}
