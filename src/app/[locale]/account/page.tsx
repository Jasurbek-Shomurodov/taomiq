import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary, type Dictionary } from "@/i18n";
import { formatSum, isLocale, plural, type Locale } from "@/i18n/config";
import { requireCustomer } from "@/lib/account/auth";
import { authMethods, isAccountEnabled } from "@/lib/account/methods";
import { orderProgress, renewDue, type OrderProgress } from "@/lib/account/order-status";
import { listMyOrders, type CustomerOrder } from "@/lib/account/orders";
import { STATUS_TONES } from "@/lib/admin/orders";
import { getPrograms } from "@/lib/data/catalog";
import type { Program } from "@/lib/data/types";
import { tashkentToday } from "@/lib/order/days";
import { pageMetadata } from "@/lib/seo";
import { AccountAnalytics, NameForm, SignOutButton } from "./AccountForms";

export async function generateMetadata({ params }: PageProps<"/[locale]/account">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale) || !isAccountEnabled) return {};
  const t = getDictionary(locale);
  return pageMetadata({ locale, path: "/account", title: t.account.title, description: t.account.lead, index: false });
}

/** The customer's own page: profile, sign-in methods, their orders, sign out. */
export default async function AccountPage({ params }: PageProps<"/[locale]/account">) {
  const { locale } = await params;
  if (!isLocale(locale) || !isAccountEnabled) notFound();
  const t = getDictionary(locale);

  return (
    <PageTransition>
      <section className="bg-forest text-ivory">
        <div className="container-page py-10 md:py-14">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-4xl md:text-6xl">{t.account.title}</h1>
          <p className="mt-3 max-w-xl text-ivory/80">{t.account.lead}</p>
        </div>
      </section>

      {/* Reads the session: per request, behind the boundary. */}
      <Suspense fallback={<AccountSkeleton />}>
        <AccountContent locale={locale} t={t} />
      </Suspense>
    </PageTransition>
  );
}

async function AccountContent({ locale, t }: { locale: Locale; t: Dictionary }) {
  const customer = await requireCustomer(locale);
  const a = t.account;
  const profile = customer.profile;

  return (
    <div className="container-page grid max-w-3xl gap-8 py-10 md:py-14">
      <AccountAnalytics
        userId={customer.id}
        signedInAt={customer.signedInAt}
        method={customer.lastMethod}
        locale={locale}
      />
      {/* data-ph-mask (both sections): session replays never show the customer's name, phone, email or orders, and
          clicks inside them are not autocaptured (src/lib/analytics/client.ts). */}
      <section className="rounded-3xl bg-white p-6 md:p-8" data-ph-mask>
        <h2 className="font-serif text-2xl text-forest md:text-3xl">{a.profile}</h2>
        <NameForm locale={locale} name={profile?.name ?? ""} t={a} />

        <dl className="mt-8 grid gap-5 border-t border-line pt-6">
          {/* No phone (an email or Google sign-in): the row is left out rather than shown as "not set". */}
          {profile?.phone && (
            <Row label={a.phone}>
              <span className="font-semibold">{profile.phone}</span>
              {profile.phone_verified && <span className="ml-2 text-sm text-muted">· {a.phoneVerified}</span>}
            </Row>
          )}
          <Row label={a.emailLabel}>
            {customer.email ? <span className="font-semibold break-all">{customer.email}</span> : <span className="text-muted">{a.none}</span>}
          </Row>
          <Row label={a.methods}>
            {customer.methods.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {customer.methods.map((method) => (
                  <li key={method} className="rounded-full bg-ivory-deep px-3 py-1 text-sm text-forest">
                    {a.methodNames[method]}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted">{a.none}</span>
            )}
          </Row>
        </dl>
      </section>

      <section aria-labelledby="my-orders" className="rounded-3xl bg-white p-6 md:p-8" data-ph-mask>
        <h2 id="my-orders" className="font-serif text-2xl text-forest md:text-3xl">
          {a.myOrders}
        </h2>
        <Suspense fallback={<OrdersSkeleton />}>
          <MyOrders locale={locale} t={t} />
        </Suspense>
      </section>

      {/* The order button lives in the orders card (MyOrders): one call to action per page. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <SignOutButton locale={locale} t={a} />
      </div>
    </div>
  );
}

/** The customer's own orders, newest first. A failed read shows one sentence instead of breaking the page. */
async function MyOrders({ locale, t }: { locale: Locale; t: Dictionary }) {
  const a = t.account;
  const o = t.order;
  // The note promises that earlier orders appear after a Telegram sign-in: say it only when that method is on.
  const telegramOn = authMethods.includes("telegram");

  let orders: CustomerOrder[];
  try {
    orders = await listMyOrders();
  } catch (error) {
    console.error("account: orders read failed", error instanceof Error ? error.message : error);
    return (
      <>
        <p role="alert" className="mt-4 rounded-2xl bg-danger/10 p-4 text-danger">
          {a.ordersFailed}
        </p>
        <Link href={`/${locale}/order`} className="btn btn-gold mt-5 min-h-12">
          {a.orderCta}
        </Link>
      </>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="mt-4">
        <p className="text-muted">{a.ordersEmpty}</p>
        <Link href={`/${locale}/order`} className="btn btn-gold mt-5 min-h-12">
          {a.orderCta}
        </Link>
        {telegramOn && <p className="mt-5 text-sm text-muted">{a.ordersNote}</p>}
      </div>
    );
  }

  const date = (iso: string) =>
    `${Number(iso.slice(8, 10))} ${o.monthNames[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${o.monthNames[Number(iso.slice(5, 7)) - 1]}`;

  // The status line and the Renew button come from the order's own dates (src/lib/account/order-status.ts). The
  // catalogue only turns the saved program name into the order form's ?program=&kcal=; without it, Renew opens the
  // plain form.
  const today = tashkentToday();
  let programs: Program[] = [];
  try {
    programs = await getPrograms();
  } catch (error) {
    console.error("account: catalogue unavailable", error instanceof Error ? error.message : error);
  }
  const progressText = (progress: OrderProgress) => {
    switch (progress.kind) {
      case "starts":
        return a.progressStarts.replace("{date}", shortDate(progress.date));
      case "running":
        return a.progressRunning
          .replace("{n}", String(progress.day))
          .replace("{days}", String(progress.days))
          .replace("{date}", shortDate(progress.end));
      case "ended":
        return a.progressEnded.replace("{date}", shortDate(progress.date));
    }
  };
  const cards = orders.map((order) => {
    const progress = orderProgress(order, today);
    return { order, progress, renewHref: renewDue(progress, today) ? renewHref(locale, order, programs) : null };
  });
  // One gold order button per page: when a card offers Renew, the general order button below steps back to outline.
  const renewing = cards.some((card) => card.renewHref);

  return (
    <>
      <ul className="mt-5 grid gap-3">
        {cards.map(({ order, progress, renewHref }) => (
          <li key={order.number} className="rounded-2xl border border-line p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-forest tabular-nums">
                {a.orderNumber.replace("{n}", String(order.number))}
              </p>
              <span className={`rounded-full px-3 py-1 text-sm ${STATUS_TONES[order.status]}`}>
                {a.statuses[order.status]}
              </span>
            </div>
            <p className="mt-2 text-graphite">
              {order.program_name} · {order.kcal} {o.kcal} · {order.days} {plural(order.days, o.dayForms)}
              {order.weekdays_only ? ` · ${o.weekdaysShort}` : ""}
            </p>
            {progress && (
              <p className="mt-1 text-sm font-semibold text-forest tabular-nums" data-order-progress>
                {progressText(progress)}
              </p>
            )}
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted">{a.orderStart}</dt>
                <dd className="tabular-nums">{date(order.start_date)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted">{a.orderTotal}</dt>
                <dd className="font-semibold tabular-nums">
                  {formatSum(order.total)} {o.currency}
                </dd>
              </div>
            </dl>
            {renewHref && (
              <Link
                href={renewHref}
                aria-label={`${a.renew}: ${order.program_name} ${order.kcal} ${o.kcal}`}
                className="btn btn-gold mt-4 min-h-12 w-full sm:w-auto"
              >
                {a.renew}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {/* One order button per page: here under the list, or in the empty or failed state above. */}
      <Link
        href={`/${locale}/order`}
        className={`btn mt-5 min-h-12 ${renewing ? "btn-outline text-forest" : "btn-gold"}`}
      >
        {a.orderCta}
      </Link>
      {telegramOn && <p className="mt-5 text-sm text-muted">{a.ordersNote}</p>}
    </>
  );
}

/**
 * The order form for the same program and level again. Orders keep a snapshot of the program's name, not its slug
 * (my_orders, 0007), so the name is matched to the catalogue; a renamed or removed program opens the plain form, and a
 * removed level the program's first.
 */
function renewHref(locale: Locale, order: CustomerOrder, programs: Program[]): string {
  const name = order.program_name.trim().toLowerCase();
  const program = programs.find((p) => p.name.trim().toLowerCase() === name);
  if (!program) return `/${locale}/order`;
  const query = new URLSearchParams({ program: program.slug });
  if (program.variants.some((v) => v.kcal === order.kcal)) query.set("kcal", String(order.kcal));
  return `/${locale}/order?${query}`;
}

function OrdersSkeleton() {
  return (
    <div className="mt-5 grid gap-3" aria-hidden>
      <div className="h-28 animate-pulse rounded-2xl bg-ivory-deep" />
      <div className="h-28 animate-pulse rounded-2xl bg-ivory-deep" />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="label text-muted">{label}</dt>
      <dd className="text-graphite">{children}</dd>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="container-page grid max-w-3xl gap-8 py-10 md:py-14" aria-hidden>
      <div className="h-80 animate-pulse rounded-3xl bg-ivory-deep" />
      <div className="h-12 w-48 animate-pulse rounded-full bg-ivory-deep" />
    </div>
  );
}
