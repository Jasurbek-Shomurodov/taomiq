import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary, type Dictionary } from "@/i18n";
import { isLocale, type Locale } from "@/i18n/config";
import { getDurations, getOrderSettings, getPrograms } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import { trialAtWeekPrice } from "@/lib/data/types";
import { getCustomer } from "@/lib/account/auth";
import { parseExclusions } from "@/lib/allergens";
import { readRepeatOrder, readSavedDelivery, type RepeatOrder } from "@/lib/account/delivery";
import { isAccountEnabled } from "@/lib/account/methods";
import { pickRepeatVariant, repeatNumberOf } from "@/lib/order/repeat";
import { SOURCE_KEYS, SOURCE_VALUE_MAX, phoneDigits, startDateRange } from "@/lib/order/rules";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { turnstileWidgetKey } from "@/lib/turnstile/config";
import { OrderForm, type OrderPrefill, type OrderProgram } from "./OrderForm";

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

  // Signed in: name and phone come pre-filled from the profile. Signed out (no auth cookies) this makes no
  // network call; a failed session check just leaves the fields empty.
  const customerPromise = getCustomer().catch((error: unknown) => {
    console.error("order page: session check failed", error instanceof Error ? error.message : error);
    return null;
  });

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
  let program =
    programs.find((p) => p.slug === pick("program")) ?? programs.find((p) => p.slug === "balance") ?? programs[0];
  let variant = program.variants.find((v) => String(v.kcal) === pick("kcal")) ?? program.variants[0];

  const source: Record<string, string> = {};
  for (const key of SOURCE_KEYS) {
    const value = pick(key)?.trim();
    if (value) source[key] = value.slice(0, SOURCE_VALUE_MAX);
  }

  const { earliest, latest } = startDateRange(new Date(), settings.cutoffHour);
  const customer = await customerPromise;
  const profile = customer?.profile;

  // ?repeat=<order number> ("Repeat last order" and Renew in the account): only the number is in the URL; the rest is
  // read on the server, from the signed-in customer's own order. Signed out: the login page first, then back here.
  const repeatNumber = isAccountEnabled ? repeatNumberOf(pick("repeat")) : null;
  if (repeatNumber && !customer) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/order?repeat=${repeatNumber}`)}`);
  }

  // Signed in: the saved address, time and courier note (0030), and the order to repeat. A failed read leaves the
  // fields empty; the order is never blocked by it.
  const [saved, repeat] = customer
    ? await Promise.all([readSavedDelivery(customer.id), repeatNumber ? readRepeatOrder(repeatNumber) : null])
    : [null, null];
  const delivery = saved && saved !== "failed" ? saved : null;
  const validWindow = (w: string | undefined) => (w && settings.deliveryWindows.includes(w) ? w : undefined);

  const o = t.order;
  let prefill: OrderPrefill | undefined;
  let notice = "";
  if (delivery) {
    prefill = { address: delivery.address, window: validWindow(delivery.window), comment: delivery.note };
  }
  if (repeatNumber) {
    if (repeat && repeat !== "failed") {
      ({ program, variant, notice } = repeatChoice(programs, repeat, program, variant, o));
      if (!notice) notice = o.repeatFrom.replace("{n}", String(repeatNumber));
      // A saved address (and its courier note) wins over the old order's: it is what the customer keeps up to date. The
      // plan, days, time and exclusions still come from the order.
      const own = delivery?.address ? delivery : null;
      if (own && own.address !== repeat.address) notice = `${notice} ${o.repeatSavedAddress}`;
      // "Без: молоко, орехи. лук" back into the chips and the free text (an older order is all free text).
      const exclusions = parseExclusions(repeat.exclusions);
      prefill = {
        days: durations.some((d) => d.days === repeat.days) ? repeat.days : undefined,
        weekdaysOnly: repeat.weekdaysOnly,
        address: own ? own.address : repeat.address,
        window: validWindow(repeat.window) ?? prefill?.window,
        comment: own ? own.note : repeat.comment,
        exclusions: exclusions.other,
        exclusionTags: exclusions.tags,
      };
    } else {
      notice = o.repeatFailed.replace("{n}", String(repeatNumber));
    }
  }

  return (
    <OrderForm
      locale={locale}
      t={t.order}
      ta={t.allergens}
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
      initialName={profile?.name ?? ""}
      initialPhone={profile?.phone ? phoneDigits(profile.phone) : ""}
      turnstileKey={turnstileWidgetKey}
      trialNote={trialAtWeekPrice(durations) ? t.durations.trialSamePrice : ""}
      prefill={prefill}
      canSaveDelivery={Boolean(customer)}
      notice={notice}
      resumable={!pick("program") && !pick("repeat")}
    />
  );
}

/**
 * The program and level of a repeated order in today's catalogue: the same level, else the same program's nearest level
 * with a note, else the page's default choice with a note.
 */
function repeatChoice(
  programs: OrderProgram[],
  repeat: RepeatOrder,
  program: OrderProgram,
  variant: OrderProgram["variants"][number],
  o: Dictionary["order"],
): { program: OrderProgram; variant: OrderProgram["variants"][number]; notice: string } {
  const pickResult = pickRepeatVariant(programs, repeat);
  if (pickResult.kind === "none") return { program, variant, notice: o.repeatProgram };
  const found = programs.find((p) => p.slug === pickResult.programSlug) ?? program;
  const level = found.variants.find((v) => v.id === pickResult.variantId) ?? found.variants[0];
  const notice =
    pickResult.kind === "nearest"
      ? o.repeatLevel.replace("{from}", String(pickResult.fromKcal)).replace("{to}", String(pickResult.toKcal))
      : "";
  return { program: found, variant: level, notice };
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
