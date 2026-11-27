import type { Dictionary } from "@/i18n";
import { isAccountEnabled } from "@/lib/account/methods";
import { getOrderSettings } from "@/lib/data/catalog";
import { DEFAULT_CUTOFF_HOUR } from "@/lib/order/rules";

/** "How it works": the three steps from choosing a program to the morning delivery. Home and goal pages. */
export function HowItWorks({ t, id }: { t: Dictionary; /** Anchor for in-page links (home: "how"). */ id?: string }) {
  return (
    <section id={id} className="container-page scroll-mt-20 lg:scroll-mt-28 py-16 md:py-20">
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
  );
}

/**
 * "Already included in the price": delivery, exclusions and swaps, pause, one price. Home and goal pages. Only what
 * is true today (docs/plans/customer-site-round-2.md, item 2): a pause or a move is made in the account before the
 * order cutoff hour the day before (docs/plans/pause-and-skip-days.md, slice 3), or asked for by message while customer
 * sign-in is off. The hour comes from the settings, so it matches the order form's start-date hint and the account.
 */
export async function Included({ t }: { t: Dictionary }) {
  let cutoffHour = DEFAULT_CUTOFF_HOUR;
  try {
    cutoffHour = (await getOrderSettings()).cutoffHour;
  } catch (error) {
    console.error("included: settings unavailable", error);
  }
  const pause = isAccountEnabled ? t.included.pause : t.included.pauseByMessage;
  // The pause line is the fourth, before the price.
  const items = [...t.included.items.slice(0, 3), pause, ...t.included.items.slice(3)].map((item) =>
    item.replace("{hour}", String(cutoffHour)),
  );
  return (
    <section className="bg-forest py-16 text-ivory md:py-20">
      <div className="container-page grid gap-10 md:grid-cols-2 md:items-center">
        <h2 className="reveal font-serif text-4xl md:text-5xl">{t.included.title}</h2>
        <ul className="grid gap-4">
          {items.map((item) => (
            <li key={item} className="reveal flex gap-4 border-b border-ivory/15 pb-4">
              <span className="mt-2.5 h-px w-6 shrink-0 bg-gold" aria-hidden />
              <span className="text-lg text-ivory/90">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
