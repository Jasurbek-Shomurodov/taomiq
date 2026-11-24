import type { Metadata } from "next";
import { Lockup } from "@/components/Logo";
import { getAdminDictionary } from "@/i18n/admin";
import { cookieLocale } from "@/lib/admin/locale";
import { AuthCard, AuthShell } from "../AuthShell";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getAdminDictionary(await cookieLocale()).setup.title };
}

/** Shown while the Supabase keys are missing from the environment. */
async function Setup() {
  const locale = await cookieLocale();
  const t = getAdminDictionary(locale);
  return (
    <AuthCard locale={locale}>
      <div className="flex flex-col items-center text-center">
        <Lockup onDark={false} width={132} />
        <h1 className="mt-8 font-serif text-3xl text-forest">{t.setup.heading}</h1>
      </div>
      <p className="mt-4 text-muted">{t.setup.text}</p>
      <ul className="mt-4 grid gap-2 break-all font-mono text-xs text-graphite sm:text-sm">
        <li>NEXT_PUBLIC_SUPABASE_URL</li>
        <li>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</li>
      </ul>
      <p className="mt-4 text-sm text-muted">{t.setup.more}</p>
    </AuthCard>
  );
}

export default function SetupPage() {
  return (
    <AuthShell placeholderClassName="h-[32rem] sm:h-[31.5rem]">
      <Setup />
    </AuthShell>
  );
}
