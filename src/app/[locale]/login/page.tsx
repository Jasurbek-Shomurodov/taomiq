import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary, type Dictionary } from "@/i18n";
import { isLocale, type Locale } from "@/i18n/config";
import { getCustomer } from "@/lib/account/auth";
import { authMethods, isAccountEnabled, safeNext } from "@/lib/account/methods";
import { pageMetadata } from "@/lib/seo";
import { LoginForm } from "./LoginForm";

export async function generateMetadata({ params }: PageProps<"/[locale]/login">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale) || !isAccountEnabled) return {};
  const t = getDictionary(locale);
  return pageMetadata({
    locale,
    path: "/login",
    title: t.account.loginTitle,
    description: t.account.loginLead,
    index: false,
  });
}

/** Sign in with Telegram, Google or an email code. Served only when NEXT_PUBLIC_AUTH_METHODS switches it on. */
export default async function LoginPage({ params, searchParams }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  if (!isLocale(locale) || !isAccountEnabled) notFound();
  const t = getDictionary(locale);

  return (
    <PageTransition>
      <section className="bg-forest text-ivory">
        <div className="container-page py-10 md:py-14">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-4xl md:text-6xl">{t.account.loginTitle}</h1>
          <p className="mt-3 max-w-xl text-ivory/80">{t.account.loginLead}</p>
        </div>
      </section>

      {/* `next`, the error and the session come from the request. */}
      <Suspense fallback={<LoginSkeleton />}>
        <LoginLoader locale={locale} t={t} searchParams={searchParams} />
      </Suspense>
    </PageTransition>
  );
}

const ERRORS = ["failed", "cancelled", "rate_limited"] as const;

async function LoginLoader({
  locale,
  t,
  searchParams,
}: {
  locale: Locale;
  t: Dictionary;
  searchParams: PageProps<"/[locale]/login">["searchParams"];
}) {
  const query = await searchParams;
  const pick = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const next = safeNext(pick("next"), locale);

  // Already signed in: straight on.
  if (await getCustomer()) redirect(next);

  const code = ERRORS.find((e) => e === pick("error"));
  const error = code === "cancelled" ? t.account.errors.cancelled : code === "rate_limited" ? t.account.errors.rateLimited : code ? t.account.errors.failed : undefined;

  return <LoginForm locale={locale} next={next} methods={authMethods} t={t.account} error={error} />;
}

function LoginSkeleton() {
  return (
    <div className="container-page max-w-md py-10 md:py-14" aria-hidden>
      <div className="grid gap-3">
        <div className="h-12 animate-pulse rounded-full bg-ivory-deep" />
        <div className="h-12 animate-pulse rounded-full bg-ivory-deep" />
        <div className="mt-6 h-28 animate-pulse rounded-2xl bg-ivory-deep" />
      </div>
    </div>
  );
}
