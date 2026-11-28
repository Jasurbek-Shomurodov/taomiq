import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Lockup } from "@/components/Logo";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary, type Dictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { getPrograms, hasAnyMenu } from "@/lib/data/catalog";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[locale]/order/success">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return pageMetadata({
    locale,
    path: "/order/success",
    title: getDictionary(locale).order.success.title,
    index: false,
  });
}

export default async function OrderSuccessPage({ params, searchParams }: PageProps<"/[locale]/order/success">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  // "Meanwhile: see the menu" only once the menu has dishes; a failed check just leaves that step out.
  let menuPublished = false;
  try {
    menuPublished = await hasAnyMenu(await getPrograms());
  } catch (error) {
    console.error("order success: menu check failed", error);
  }

  return (
    <PageTransition>
      <section className="container-page py-16 text-center md:py-24">
        <Lockup onDark={false} width={120} className="mx-auto" />
        {/* Decorative: the check draws itself in 400 ms (globals.css, .check-draw); static with reduced motion. */}
        <svg viewBox="0 0 56 56" className="mx-auto mt-8 size-14" aria-hidden>
          <circle cx="28" cy="28" r="28" className="fill-forest" />
          <path
            d="M17 29l7.5 7.5L39 21"
            fill="none"
            pathLength={1}
            strokeDasharray="1"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="check-draw stroke-gold"
          />
        </svg>
        <h1 className="mt-8 font-serif text-5xl text-forest md:text-6xl">{t.order.success.title}</h1>
        <Suspense fallback={<div className="mx-auto mt-8 h-24 w-56 animate-pulse rounded-2xl bg-ivory-deep" />}>
          <OrderNumber t={t} searchParams={searchParams} />
        </Suspense>
        {/* What happens next, and what to do meanwhile. */}
        <section aria-labelledby="success-next" className="mx-auto mt-10 max-w-xl text-left">
          <h2 id="success-next" className="label text-muted">
            {t.order.success.nextTitle}
          </h2>
          <ol className="mt-3 divide-y divide-line border-y border-line">
            <li className="flex gap-4 py-4">
              <StepNumber n={1} />
              <p className="text-graphite">{t.order.success.text}</p>
            </li>
            {menuPublished && (
              <li className="flex items-center gap-4 py-2">
                <StepNumber n={2} />
                <Link
                  href={`/${locale}/menu`}
                  className="inline-flex min-h-11 items-center font-semibold text-forest underline decoration-gold underline-offset-4"
                >
                  {t.order.success.menu}&nbsp;<span aria-hidden className="nudge">→</span>
                </Link>
              </li>
            )}
            <li className="flex items-center gap-4 py-2">
              <StepNumber n={menuPublished ? 3 : 2} />
              <a
                href={site.telegram}
                rel="noopener"
                className="inline-flex min-h-11 items-center font-semibold text-forest underline decoration-gold underline-offset-4"
              >
                {t.order.success.join}&nbsp;<span aria-hidden className="nudge">→</span>
              </a>
            </li>
          </ol>
        </section>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={`/${locale}`} className="btn btn-outline text-forest">
            {t.order.success.home}
          </Link>
        </div>
      </section>
    </PageTransition>
  );
}

async function OrderNumber({
  t,
  searchParams,
}: {
  t: Dictionary;
  searchParams: PageProps<"/[locale]/order/success">["searchParams"];
}) {
  const raw = (await searchParams).n;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{1,12}$/.test(value)) return null;

  return (
    <div className="number-rise mx-auto mt-8 inline-block rounded-2xl border border-line bg-white px-8 py-5">
      <p className="label text-muted">{t.order.success.number}</p>
      <p className="mt-1 font-serif text-4xl text-forest tabular-nums">№ {value}</p>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span aria-hidden className="w-8 shrink-0 pt-0.5 font-serif text-xl leading-none text-gold-ink tabular-nums">
      {String(n).padStart(2, "0")}
    </span>
  );
}
