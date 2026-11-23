import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[locale]/privacy">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({ locale, path: "/privacy", title: t.privacy.title, description: t.privacy.lead });
}

export default async function PrivacyPage({ params }: PageProps<"/[locale]/privacy">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  return (
    <>
      <section className="bg-forest text-ivory">
        <div className="container-page py-12 md:py-16">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-4xl md:text-6xl">{t.privacy.title}</h1>
          <p className="mt-3 max-w-xl text-ivory/80">{t.privacy.lead}</p>
        </div>
      </section>

      <article className="container-page max-w-3xl py-12 md:py-16">
        <p className="text-sm text-muted">{t.privacy.updated}</p>
        {t.privacy.sections.map((section) => (
          <section key={section.title} className="mt-10 border-t border-line pt-6">
            <h2 className="font-serif text-2xl text-forest md:text-3xl">{section.title}</h2>
            <ul className="mt-4 grid gap-3">
              {section.items.map((item) => (
                <li key={item} className="flex gap-4 leading-relaxed text-graphite">
                  <span className="mt-3 h-px w-5 shrink-0 bg-gold" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <a href={site.telegram} className="btn btn-forest mt-10" rel="noopener">
          {t.privacy.contact}
        </a>
      </article>
    </>
  );
}
