import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary, type Dictionary } from "@/i18n";
import { isLocale, type Locale } from "@/i18n/config";
import { getDurations, getOrderSettings, getPrograms } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import { SOURCE_KEYS, SOURCE_VALUE_MAX, startDateRange } from "@/lib/order/rules";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { OrderForm, type OrderProgram } from "./OrderForm";

export async function generateMetadata({ params }: PageProps<"/[locale]/order">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({ locale, path: "/order", title: t.order.title, description: t.order.lead, index: false });
}

export default async function OrderPage({ params, searchParams }: PageProps<"/[locale]/order">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  return (
    <PageTransition>
      <section className="bg-forest text-ivory">
        <div className="container-page py-10 md:py-14">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-4xl md:text-6xl">{t.order.title}</h1>
          <p className="mt-3 max-w-xl text-ivory/80">{t.order.lead}</p>
        </div>
      </section>

      {/* Preselection and attribution come from the URL, and the start date from the clock: per request. */}
      <Suspense fallback={<OrderSkeleton />}>
        <OrderLoader locale={locale} t={t} searchParams={searchParams} />
      </Suspense>
    </PageTransition>
  );
}

async function OrderLoader({
  locale,
  t,
  searchParams,
}: {
  locale: Locale;
  t: Dictionary;
  searchParams: PageProps<"/[locale]/order">["searchParams"];
}) {
  const query = await searchParams;
  await connection();
  const pick = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  let catalog;
  try {
    catalog = await Promise.all([getPrograms(), getDurations(), getOrderSettings()]);
  } catch (error) {
    console.error("order page: catalogue unavailable", error);
    return <Unavailable t={t} message={t.order.general.failed} />;
  }
  const [allPrograms, durations, settings] = catalog;

  const programs: OrderProgram[] = allPrograms
    .filter((p) => p.variants.length > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      tagColor: p.tag_color,
      tagline: localized(p, "tagline", locale),
      variants: p.variants.map((v) => ({ id: v.id, kcal: v.kcal, meals: v.meals_per_day, price: v.price_per_day })),
    }));
  if (programs.length === 0 || durations.length === 0) {
    return <Unavailable t={t} message={t.order.empty} />;
  }

  // ?program=balance&kcal=1800 from program pages and the calculator
  const program =
    programs.find((p) => p.slug === pick("program")) ?? programs.find((p) => p.slug === "balance") ?? programs[0];
  const variant = program.variants.find((v) => String(v.kcal) === pick("kcal")) ?? program.variants[0];

  const source: Record<string, string> = {};
  for (const key of SOURCE_KEYS) {
    const value = pick(key)?.trim();
    if (value) source[key] = value.slice(0, SOURCE_VALUE_MAX);
  }

  const { earliest, latest } = startDateRange(new Date(), settings.cutoffHour);

  return (
    <OrderForm
      locale={locale}
      t={t.order}
      programs={programs}
      durations={durations}
      windows={settings.deliveryWindows}
      cutoffHour={settings.cutoffHour}
      earliest={earliest}
      latest={latest}
      initialProgram={program.slug}
      initialVariant={variant.id}
      source={source}
      telegramUrl={site.telegram}
    />
  );
}

function Unavailable({ t, message }: { t: Dictionary; message: string }) {
  return (
    <section className="container-page py-14 text-center md:py-20">
      <p className="mx-auto max-w-xl text-lg text-muted">{message}</p>
      <a href={site.telegram} className="btn btn-forest mt-6" rel="noopener">
        {t.order.telegram}
      </a>
    </section>
  );
}

function OrderSkeleton() {
  return (
    <div className="container-page grid gap-8 py-8 md:grid-cols-[minmax(0,1fr)_20rem] md:py-12" aria-hidden>
      <div className="grid gap-6">
        <div className="h-40 animate-pulse rounded-2xl bg-ivory-deep" />
        <div className="h-28 animate-pulse rounded-2xl bg-ivory-deep" />
        <div className="h-28 animate-pulse rounded-2xl bg-ivory-deep" />
      </div>
      <div className="hidden h-72 animate-pulse rounded-3xl bg-ivory-deep md:block" />
    </div>
  );
}
