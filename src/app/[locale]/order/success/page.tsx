import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDictionary, type Dictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { site } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[locale]/order/success">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: getDictionary(locale).order.success.title, robots: { index: false, follow: false } };
}

export default async function OrderSuccessPage({ params, searchParams }: PageProps<"/[locale]/order/success">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  return (
    <section className="container-page py-16 text-center md:py-24">
      <p className="label text-gold">TAOMIQ</p>
      <h1 className="mt-3 font-serif text-5xl text-forest md:text-6xl">{t.order.success.title}</h1>
      <Suspense fallback={<div className="mx-auto mt-8 h-24 w-56 animate-pulse rounded-2xl bg-ivory-deep" />}>
        <OrderNumber t={t} searchParams={searchParams} />
      </Suspense>
      <p className="mx-auto mt-6 max-w-xl text-lg text-muted">{t.order.success.text}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <a href={site.telegram} className="btn btn-forest" rel="noopener">
          {t.order.success.telegram}
        </a>
        <Link href={`/${locale}`} className="btn btn-outline text-forest">
          {t.order.success.home}
        </Link>
      </div>
    </section>
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
    <div className="mx-auto mt-8 inline-block rounded-2xl border border-line bg-white px-8 py-5">
      <p className="label text-muted">{t.order.success.number}</p>
      <p className="mt-1 font-serif text-4xl text-forest tabular-nums">№ {value}</p>
    </div>
  );
}
