import type { Metadata } from "next";
import { Suspense } from "react";
import { Lockup } from "@/components/Logo";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang } from "@/i18n/config";
import { cookieLocale } from "@/lib/admin/locale";
import { LanguageSwitch } from "../LanguageSwitch";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getAdminDictionary(await cookieLocale()).setup.title };
}

/** Shown while the Supabase keys are missing from the environment. */
async function Setup() {
  const locale = await cookieLocale();
  const t = getAdminDictionary(locale);
  return (
    <div lang={htmlLang[locale]} className="w-full max-w-lg rounded-3xl bg-ivory p-8">
      <div className="flex items-start justify-between gap-4">
        <Lockup onDark={false} width={112} />
        <LanguageSwitch locale={locale} label={t.switcher.label} onLight />
      </div>
      <h1 className="mt-4 font-serif text-3xl text-forest">{t.setup.heading}</h1>
      <p className="mt-3 text-muted">{t.setup.text}</p>
      <ul className="mt-4 grid gap-2 font-mono text-sm text-graphite">
        <li>NEXT_PUBLIC_SUPABASE_URL</li>
        <li>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</li>
      </ul>
      <p className="mt-4 text-sm text-muted">{t.setup.more}</p>
    </div>
  );
}

export default function SetupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-forest p-5">
      <Suspense fallback={<div className="h-80 w-full max-w-lg rounded-3xl bg-ivory" />}>
        <Setup />
      </Suspense>
    </main>
  );
}
