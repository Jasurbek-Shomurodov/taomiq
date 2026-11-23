import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { Monogram } from "@/components/Logo";
import { MenuDay } from "@/components/MenuDay";
import { getDictionary } from "@/i18n";
import { formatSum, isLocale } from "@/i18n/config";
import { getMenuDay, getPrograms, getTodayCycleDay, isDemoCatalog } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { faqPage } from "@/lib/structured-data";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({
    locale,
    path: "",
    title: t.meta.title,
    description: t.meta.description,
    absoluteTitle: true,
  });
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  const programs = await getPrograms();
  const minPrice = Math.min(...programs.flatMap((p) => p.variants.map((v) => v.price_per_day)));

  // "Today's menu" preview: the middle program at its first calorie level.
  const featured = programs.find((p) => p.slug === "balance") ?? programs[0];
  const featuredVariant = featured?.variants[0];
  const today = await getTodayCycleDay();
  const todayMenu = featuredVariant ? await getMenuDay(featuredVariant.id, today) : [];
  // While the cook is still filling the cycle, fall back to day 1 so the section is never empty.
  const preview = todayMenu.length > 0 || !featuredVariant ? todayMenu : await getMenuDay(featuredVariant.id, 1);

  return (
    <>
      {/* Hero */}
      <section className="bg-forest text-ivory">
        <div className="container-page grid gap-10 py-16 md:grid-cols-[1.3fr_1fr] md:items-center md:py-24">
          <div className="hero-enter">
            <p className="label text-gold">{t.hero.eyebrow}</p>
            <h1 className="mt-5 font-serif text-5xl leading-[1.05] sm:text-6xl md:text-7xl">
              {t.hero.title}
              <br />
              <span className="text-gold">{t.hero.titleAccent}</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ivory/80">{t.hero.lead}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link href={`/${locale}/order`} className="btn btn-gold w-full sm:w-auto">{t.hero.cta}</Link>
              <Link href={`/${locale}/menu`} className="btn btn-outline w-full text-ivory sm:w-auto">
                {t.hero.secondary}
              </Link>
            </div>
            {Number.isFinite(minPrice) && (
              <p className="mt-6 text-sm text-ivory/70">
                {t.hero.from} <span className="font-semibold text-ivory">{formatSum(minPrice)}</span> {t.hero.perDay}
              </p>
            )}
          </div>

          <div className="hidden justify-self-center md:block" aria-hidden>
            <div className="flex h-72 w-72 items-center justify-center rounded-full border border-gold/40">
              <div className="flex h-56 w-56 items-center justify-center rounded-full border border-gold/70">
                <Monogram size={132} />
              </div>
            </div>
          </div>
        </div>

        <ul className="container-page grid gap-px border-t border-ivory/10 sm:grid-cols-2 lg:grid-cols-4">
          {t.pillars.map((pillar) => (
            <li key={pillar.title} className="py-6 pr-6">
              <p className="label text-gold">{pillar.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-ivory/75">{pillar.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section id="how" className="container-page scroll-mt-28 py-16 md:py-20">
        <h2 className="reveal font-serif text-4xl text-forest md:text-5xl">{t.how.title}</h2>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {t.how.steps.map((step, index) => (
            <li key={step.title} className="reveal border-t border-gold pt-5">
              <p className="font-serif text-3xl text-gold">0{index + 1}</p>
              <h3 className="mt-2 text-lg font-semibold text-forest">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Programs */}
      <section id="programs" className="scroll-mt-28 bg-ivory-deep py-16 md:py-20">
        <div className="container-page">
          <h2 className="reveal font-serif text-4xl text-forest md:text-5xl">{t.programs.title}</h2>
          <p className="mt-3 max-w-2xl text-muted">{t.programs.lead}</p>

          <ul className="mt-10 grid gap-5 md:grid-cols-3">
            {programs.map((program) => {
              const from = Math.min(...program.variants.map((v) => v.price_per_day));
              return (
                <li key={program.id} className="reveal flex flex-col rounded-3xl bg-forest p-7 text-ivory">
                  <span className="h-1.5 w-12 rounded-full" style={{ background: program.tag_color }} />
                  <p className="label mt-5 text-ivory/60">TAOMIQ</p>
                  <h3 className="font-serif text-4xl">{program.name}</h3>
                  <p className="mt-1 text-gold">{localized(program, "tagline", locale)}</p>
                  <p className="mt-4 text-sm leading-relaxed text-ivory/75">
                    {localized(program, "description", locale)}
                  </p>

                  <p className="label mt-6 text-ivory/60">{t.programs.levels}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {program.variants.map((variant) => (
                      <span key={variant.id} className="rounded-full border border-ivory/25 px-3 py-1 text-sm tabular-nums">
                        {variant.kcal} {t.programs.kcal}
                      </span>
                    ))}
                  </div>

                  <p className="mt-6 text-sm text-ivory/70">
                    {t.hero.from}{" "}
                    <span className="font-serif text-2xl text-ivory">{formatSum(from)}</span> {t.hero.perDay}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-6">
                    <Link href={`/${locale}/programs/${program.slug}`} className="btn btn-gold !px-5 !py-2.5 !text-sm">
                      {t.programs.details}
                    </Link>
                    <Link
                      href={`/${locale}/menu?program=${program.slug}`}
                      className="btn btn-outline !px-5 !py-2.5 !text-sm text-ivory"
                    >
                      {t.programs.viewMenu}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-sm text-muted">{t.programs.priceNote}</p>
        </div>
      </section>

      {/* Today's menu */}
      {featured && featuredVariant && (
        <section className="container-page py-16 md:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label text-muted">
                TAOMIQ {featured.name} / {featuredVariant.kcal}
              </p>
              <h2 className="reveal mt-2 font-serif text-4xl text-forest md:text-5xl">{t.menu.today}</h2>
            </div>
            <Link href={`/${locale}/menu`} className="btn btn-outline text-forest">{t.menu.full}</Link>
          </div>
          <div className="mt-8">
            <MenuDay entries={preview} targetKcal={featuredVariant.kcal} locale={locale} t={t} />
          </div>
          {isDemoCatalog && <p className="mt-4 text-sm text-muted">{t.menu.demoNote}</p>}
        </section>
      )}

      {/* Included */}
      <section className="bg-forest py-16 text-ivory md:py-20">
        <div className="container-page grid gap-10 md:grid-cols-2 md:items-center">
          <h2 className="reveal font-serif text-4xl md:text-5xl">{t.included.title}</h2>
          <ul className="grid gap-4">
            {t.included.items.map((item) => (
              <li key={item} className="reveal flex gap-4 border-b border-ivory/15 pb-4">
                <span className="mt-2.5 h-px w-6 shrink-0 bg-gold" aria-hidden />
                <span className="text-lg text-ivory/90">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="container-page scroll-mt-28 py-16 md:py-20">
        <JsonLd data={faqPage(t.faq.items, locale)} />
        <h2 className="reveal font-serif text-4xl text-forest md:text-5xl">{t.faq.title}</h2>
        <div className="mt-8 max-w-3xl divide-y divide-line border-y border-line">
          {t.faq.items.map((item) => (
            <details key={item.q} className="faq group">
              {/* Padding lives on the summary so the whole 56 px+ row is the tap target. */}
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-5 text-lg font-semibold text-forest">
                {item.q}
                <span
                  className="text-gold transition-transform duration-(--duration-base) ease-out-calm group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="pb-5 leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final call to action */}
      <section className="bg-ivory-deep py-16 md:py-20">
        <div className="container-page text-center">
          <h2 className="reveal font-serif text-4xl text-forest md:text-5xl">{t.cta.title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">{t.cta.text}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={`/${locale}/order`} className="btn btn-forest">{t.cta.button}</Link>
            <a href={site.telegram} className="btn btn-outline text-forest" rel="noopener">{t.cta.telegram}</a>
          </div>
        </div>
      </section>
    </>
  );
}
