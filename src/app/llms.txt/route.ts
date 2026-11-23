import { localeNameEn, locales } from "@/i18n/config";
import { getDurations, getPrograms } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import { pricePerDay } from "@/lib/data/types";
import { site } from "@/lib/site";

/**
 * /llms.txt: a plain-text summary of the site for AI search and assistants (llmstxt.org format). Programs,
 * calorie levels and prices come from the catalogue, so the file never disagrees with the pages; every URL
 * is built from site.url. States only what the site itself shows.
 */
export async function GET() {
  const [programs, durations] = await Promise.all([getPrograms(), getDurations()]);
  const url = (locale: string, path = "") => `${site.url}/${locale}${path}`;
  const everyLocale = (path: string) => locales.map((l) => `${l}: ${url(l, path)}`).join(" · ");
  const sum = (n: number) => `${Math.round(n).toLocaleString("en-US").replace(/,/g, " ")} UZS`;

  const programLines = programs
    .filter((p) => p.variants.length > 0)
    .flatMap((program) => [
      `### ${program.name}`,
      "",
      ...locales.map((l) => `In ${localeNameEn[l]}: ${localized(program, "description", l)}`),
      "",
      ...program.variants.map((v) => {
        // Per-day price for each order length, as the price table on the program page shows it.
        const prices = durations.length > 0 ? durations.map((d) => pricePerDay(v.price_per_day, d.markup_pct)) : [v.price_per_day];
        const low = Math.min(...prices);
        const high = Math.max(...prices);
        const price =
          low === high ? `${sum(low)} per day` : `${sum(low)} to ${sum(high)} per day, depending on order length`;
        return `- ${v.kcal} kcal per day, ${v.meals_per_day} meals: ${price}`;
      }),
      "",
      `Program page: ${everyLocale(`/programs/${program.slug}`)}`,
      "",
    ]);

  const languageList = locales.map((l) => `${localeNameEn[l]} (/${l})`);
  const languages =
    languageList.length > 1 ? `${languageList.slice(0, -1).join(", ")} and ${languageList.at(-1)}` : languageList[0];

  const durationText = durations
    .map((d) => `${d.days} days${d.is_trial ? " (trial)" : ""}`)
    .join(", ");

  const body = [
    `# ${site.name}`,
    "",
    `> ${site.name} delivers ready daily meal plans in Tashkent, Uzbekistan: a full day of food, cooked at night and delivered every morning in a two-hour window the customer chooses. Every dish lists its ingredients, weight, calories, protein, fat and carbohydrates. The site is in ${languages}.`,
    "",
    `- Delivery: inside the Tashkent ring road, every morning, 7 days a week or weekdays only; delivery is included in the price.`,
    `- Order lengths: ${durationText}. Prices are per day, in Uzbek sum (UZS), and the price on the site is the price paid.`,
    `- Menu: a 30-day cycle without repeats, published on the site before ordering.`,
    `- Halal: no pork and no alcohol.`,
    `- Ordering: online form on the site; a manager confirms the order and payment by phone or Telegram.`,
    "",
    "## Programs",
    "",
    ...programLines,
    "## Key pages",
    "",
    `- Home: ${everyLocale("")}`,
    `- 30-day menu: ${everyLocale("/menu")}`,
    `- Calorie and macro calculator: ${everyLocale("/calculator")}`,
    `- Delivery area and times: ${everyLocale("/delivery")}`,
    `- Order: ${everyLocale("/order")}`,
    `- Privacy policy: ${everyLocale("/privacy")}`,
    "",
    "## Contact",
    "",
    `- Telegram: ${site.telegram}`,
    `- Instagram: ${site.instagram}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
