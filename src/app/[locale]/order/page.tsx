import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { site } from "@/lib/site";

// Placeholder until the order configurator and Payme/Click checkout are built.
export const metadata: Metadata = { robots: { index: false } };

export default async function OrderPage({ params }: PageProps<"/[locale]/order">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  return (
    <section className="container-page py-20 text-center md:py-28">
      <p className="label text-muted">TAOMIQ</p>
      <h1 className="mt-3 font-serif text-5xl text-forest">{t.order.title}</h1>
      <p className="mx-auto mt-5 max-w-xl text-lg text-muted">{t.order.text}</p>
      <a href={site.telegram} className="btn btn-forest mt-8" rel="noopener">
        {t.cta.telegram}
      </a>
    </section>
  );
}
