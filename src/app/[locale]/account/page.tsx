import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary, type Dictionary } from "@/i18n";
import { isLocale, type Locale } from "@/i18n/config";
import { requireCustomer } from "@/lib/account/auth";
import { isAccountEnabled } from "@/lib/account/methods";
import { pageMetadata } from "@/lib/seo";
import { NameForm, SignOutButton } from "./AccountForms";

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale) || !isAccountEnabled) return {};
  const t = getDictionary(locale);
  return pageMetadata({ locale, path: "/account", title: t.account.title, description: t.account.lead, index: false });
}

/** The customer's own page: profile, sign-in methods, sign out. Orders arrive in slice 2 of the plan. */
export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  const { locale } = await params;
  if (!isLocale(locale) || !isAccountEnabled) notFound();
  const t = getDictionary(locale);

  return (
    <PageTransition>
      <section className="bg-forest text-ivory">
        <div className="container-page py-10 md:py-14">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-4xl md:text-6xl">{t.account.title}</h1>
          <p className="mt-3 max-w-xl text-ivory/80">{t.account.lead}</p>
        </div>
      </section>

      {/* Reads the session: per request, behind the boundary. */}
      <Suspense fallback={<AccountSkeleton />}>
        <AccountContent locale={locale} t={t} />
      </Suspense>
    </PageTransition>
  );
}

async function AccountContent({ locale, t }: { locale: Locale; t: Dictionary }) {
  const customer = await requireCustomer(locale);
  const a = t.account;
  const profile = customer.profile;

  return (
    <div className="container-page grid max-w-3xl gap-8 py-10 md:py-14">
      <section className="rounded-3xl bg-white p-6 md:p-8">
        <h2 className="font-serif text-2xl text-forest md:text-3xl">{a.profile}</h2>
        <NameForm locale={locale} name={profile?.name ?? ""} t={a} />

        <dl className="mt-8 grid gap-5 border-t border-line pt-6">
          <Row label={a.phone}>
            {profile?.phone ? (
              <>
                <span className="font-semibold">{profile.phone}</span>
                {profile.phone_verified && <span className="ml-2 text-sm text-muted">· {a.phoneVerified}</span>}
              </>
            ) : (
              <span className="text-muted">{a.none}</span>
            )}
          </Row>
          <Row label={a.emailLabel}>
            {customer.email ? <span className="font-semibold break-all">{customer.email}</span> : <span className="text-muted">{a.none}</span>}
          </Row>
          <Row label={a.methods}>
            {customer.methods.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {customer.methods.map((method) => (
                  <li key={method} className="rounded-full bg-ivory-deep px-3 py-1 text-sm text-forest">
                    {a.methodNames[method]}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted">{a.none}</span>
            )}
          </Row>
        </dl>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href={`/${locale}/order`} className="btn btn-gold min-h-12">
          {a.orderCta}
        </Link>
        <SignOutButton locale={locale} t={a} />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="label text-muted">{label}</dt>
      <dd className="text-graphite">{children}</dd>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="container-page grid max-w-3xl gap-8 py-10 md:py-14" aria-hidden>
      <div className="h-80 animate-pulse rounded-3xl bg-ivory-deep" />
      <div className="h-12 w-48 animate-pulse rounded-full bg-ivory-deep" />
    </div>
  );
}
