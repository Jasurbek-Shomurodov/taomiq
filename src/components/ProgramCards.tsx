import Image from "next/image";
import Link from "next/link";
import { ViewTransition } from "react";
import type { Dictionary } from "@/i18n";
import { formatSum, type Locale } from "@/i18n/config";
import { localized } from "@/lib/data/localized";
import type { Program } from "@/lib/data/types";

/**
 * The program cards of the home page's Programs section and of /programs: forest cards with the cover photo, name,
 * tagline, description, calorie levels and "from … per day". Phones: a snap row, each card 85 % wide so the next
 * one peeks in (dots where the browser draws ::scroll-marker). From md: the three-column grid. The whole card links
 * to the program page; the menu link sits above that. One list per page: the names carry the view-transition name
 * that grows into the program page's h1.
 */
export function ProgramCards({
  programs,
  locale,
  t,
  className = "mt-10",
}: {
  programs: Program[];
  locale: Locale;
  t: Dictionary;
  className?: string;
}) {
  const listed = programs.filter((p) => p.variants.length > 0);
  return (
    <ul
      className={`program-row reveal -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:snap-none md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0 md:pb-0 ${className}`}
    >
      {listed.map((program) => {
        const from = Math.min(...program.variants.map((v) => v.price_per_day));
        const tagline = localized(program, "tagline", locale);
        return (
          <li
            key={program.id}
            className="press lift relative flex w-[85%] shrink-0 snap-start flex-col rounded-3xl bg-forest p-7 text-ivory md:w-auto"
          >
            {/* The cover photo fills the top of the card, edge to edge, with the card's radius. Without one
                the card is text only; cards stretch to one height in the row and the grid either way. */}
            {program.photo_url && (
              <div className="zoom relative -mx-7 -mt-7 mb-7 aspect-[3/2] rounded-t-3xl">
                <Image
                  src={program.photo_url}
                  alt={`${program.name} — ${tagline}`}
                  fill
                  sizes="(min-width: 768px) 33vw, 85vw"
                  className="object-cover"
                />
              </div>
            )}
            <span className="h-1.5 w-12 rounded-full" style={{ background: program.tag_color }} />
            <p className="label mt-5 text-ivory/60">TAOMIQ</p>
            <h3 className="font-serif text-4xl">
              <Link
                href={`/${locale}/programs/${program.slug}`}
                className="after:absolute after:inset-0 after:rounded-3xl after:content-['']"
              >
                {/* The name grows into the program page's h1 (globals.css, .program-morph). The span
                    is the named box, so the link's card-wide ::after stays out of the snapshot. */}
                <ViewTransition name={`program-name-${program.slug}`} share="program-morph" default="none">
                  <span className="inline-block">{program.name}</span>
                </ViewTransition>
              </Link>
            </h3>
            <p className="mt-1 text-gold">{tagline}</p>
            <p className="mt-4 text-sm leading-relaxed text-ivory/75">{localized(program, "description", locale)}</p>

            <p className="label mt-6 text-ivory/60">{t.programs.levels}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {program.variants.map((variant) => (
                <span key={variant.id} className="rounded-full border border-ivory/25 px-3 py-1 text-sm tabular-nums">
                  {variant.kcal} {t.programs.kcal}
                </span>
              ))}
            </div>

            <p className="mt-6 text-sm text-ivory/70">
              {t.hero.from} <span className="font-serif text-2xl text-ivory">{formatSum(from)}</span> {t.hero.perDay}
            </p>
            <div className="mt-auto flex flex-wrap gap-2 pt-6">
              {/* Looks like a button; the tap target is the whole card (the link on the name). */}
              <span aria-hidden className="btn btn-gold !px-5 !py-2.5 !text-sm">
                {t.programs.details}
              </span>
              <Link
                href={`/${locale}/menu?program=${program.slug}`}
                className="btn btn-outline relative z-10 !px-5 !py-2.5 !text-sm text-ivory"
              >
                {t.programs.viewMenu}
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
