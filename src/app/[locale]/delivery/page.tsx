import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { JsonLd } from "@/components/JsonLd";
import { PageTransition } from "@/components/PageTransition";
import { ProgramLinks } from "@/components/ProgramLinks";
import { getOrderSettings, getPrograms, type OrderSettings } from "@/lib/data/catalog";
import type { Program } from "@/lib/data/types";
import { DEFAULT_CUTOFF_HOUR, DEFAULT_DELIVERY_WINDOWS } from "@/lib/order/rules";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { breadcrumbList } from "@/lib/structured-data";

export async function generateMetadata({ params }: PageProps<"/[locale]/delivery">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({
    locale,
    path: "/delivery",
    title: t.delivery.metaTitle,
    description: t.delivery.metaDescription,
  });
}

export default async function DeliveryPage({ params }: PageProps<"/[locale]/delivery">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  // Windows and cutoff are data (settings table). If they cannot be read, show the defaults the order form also uses.
  let settings: Pick<OrderSettings, "deliveryWindows" | "cutoffHour">;
  try {
    settings = await getOrderSettings();
  } catch (error) {
    console.error("delivery page: settings unavailable", error);
    settings = { deliveryWindows: DEFAULT_DELIVERY_WINDOWS, cutoffHour: DEFAULT_CUTOFF_HOUR };
  }

  const facts = [
    { title: t.delivery.areaTitle, text: t.delivery.areaText },
    { title: t.delivery.cutoffTitle, text: t.delivery.cutoffText.replace("{hour}", String(settings.cutoffHour)) },
    { title: t.delivery.priceTitle, text: t.delivery.priceText },
  ];

  // Links to the program pages. The delivery facts still render without them.
  let programs: Program[] = [];
  try {
    programs = await getPrograms();
  } catch (error) {
    console.error("delivery page: catalogue unavailable", error);
  }

  return (
    <PageTransition>
      <JsonLd data={breadcrumbList(locale, [{ name: t.delivery.title, path: "/delivery" }])} />
      <section className="bg-forest text-ivory">
        <div className="container-page py-12 md:py-16">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-5xl md:text-6xl">{t.delivery.title}</h1>
          <p className="mt-3 max-w-xl text-lg text-ivory/80">{t.delivery.lead}</p>
        </div>
      </section>

      <section className="container-page grid gap-10 py-14 md:grid-cols-2 md:py-16">
        {/* When: the windows come from the settings table */}
        <div className="border-t border-gold pt-5 md:row-span-3">
          <h2 className="font-serif text-3xl text-forest">{t.delivery.windowsTitle}</h2>
          <p className="mt-3 leading-relaxed text-muted">{t.delivery.windowsText}</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {settings.deliveryWindows.map((window) => (
              <li
                key={window}
                className="rounded-xl border border-forest bg-white px-4 py-2.5 font-semibold text-forest tabular-nums"
              >
                {window}
              </li>
            ))}
          </ul>
        </div>

        {facts.map((fact) => (
          <div key={fact.title} className="border-t border-gold pt-5">
            <h2 className="font-serif text-3xl text-forest">{fact.title}</h2>
            <p className="mt-3 leading-relaxed text-muted">{fact.text}</p>
          </div>
        ))}
      </section>

      <section className="bg-ivory-deep py-14 md:py-16">
        <div className="container-page">
          <h2 className="font-serif text-4xl text-forest md:text-5xl">{t.delivery.handoverTitle}</h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {t.delivery.steps.map((step, index) => (
              <li key={step.title} className="border-t border-gold pt-5">
                <p className="font-serif text-3xl text-gold">0{index + 1}</p>
                <h3 className="mt-2 text-lg font-semibold text-forest">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <ProgramLinks programs={programs} locale={locale} t={t} />

      <section className="bg-ivory-deep py-14 md:py-16">
        <div className="container-page text-center">
          <h2 className="font-serif text-4xl text-forest md:text-5xl">{t.cta.title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">{t.delivery.questions}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={`/${locale}/order`} className="btn btn-forest">{t.nav.cta}</Link>
            <a href={site.telegram} className="btn btn-outline text-forest" rel="noopener">{t.cta.telegram}</a>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
