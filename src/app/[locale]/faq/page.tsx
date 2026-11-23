import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FaqList } from "@/components/FaqList";
import { JsonLd } from "@/components/JsonLd";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { breadcrumbList, faqPage } from "@/lib/structured-data";

export async function generateMetadata({ params }: PageProps<"/[locale]/faq">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({ locale, path: "/faq", title: t.faq.metaTitle, description: t.faq.metaDescription });
}

/**
 * All questions, grouped by topic. This page owns the FAQPage structured data; the home page shows the same
 * questions as a short list and links here.
 */
export default async function FaqPage({ params }: PageProps<"/[locale]/faq">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  const topics = (Object.keys(t.faq.topics) as (keyof typeof t.faq.topics)[])
    .map((topic) => ({ topic, title: t.faq.topics[topic], items: t.faq.items.filter((item) => item.topic === topic) }))
    .filter((group) => group.items.length > 0);

  return (
    <PageTransition>
      <JsonLd data={faqPage(t.faq.items, locale)} />
      <JsonLd data={breadcrumbList(locale, [{ name: t.faq.title, path: "/faq" }])} />
      <section className="bg-forest text-ivory">
        <div className="container-page py-12 md:py-16">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-4xl md:text-6xl">{t.faq.title}</h1>
          <p className="mt-3 max-w-xl text-lg text-ivory/80">{t.faq.lead}</p>
        </div>
      </section>

      <div className="container-page grid gap-12 py-12 md:gap-14 md:py-16">
        {topics.map((group) => (
          <section key={group.topic} aria-labelledby={`faq-${group.topic}`}>
            <h2 id={`faq-${group.topic}`} className="font-serif text-3xl text-forest md:text-4xl">
              {group.title}
            </h2>
            <div className="mt-4">
              <FaqList items={group.items} />
            </div>
          </section>
        ))}
      </div>

      <section className="bg-ivory-deep py-14 md:py-16">
        <div className="container-page text-center">
          <h2 className="font-serif text-3xl text-forest md:text-4xl">{t.faq.more}</h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href={site.telegram} className="btn btn-forest" rel="noopener">
              {t.cta.telegram}
            </a>
            <Link href={`/${locale}/prices`} className="btn btn-outline text-forest">
              {t.nav.prices}
            </Link>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
