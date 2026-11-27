import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary, type Dictionary } from "@/i18n";
import { formatSum, isLocale, plural, type Locale } from "@/i18n/config";
import { requireCustomer } from "@/lib/account/auth";
import { readSavedDelivery } from "@/lib/account/delivery";
import { authMethods, isAccountEnabled } from "@/lib/account/methods";
import { orderProgress, renewDue, type OrderProgress } from "@/lib/account/order-status";
import { listMyOrders, type CustomerOrder } from "@/lib/account/orders";
import { customerCanPause, customerFirstPauseDay, formatPauseRange, hasDaysToPause } from "@/lib/account/pauses";
import { STATUS_TONES } from "@/lib/admin/orders";
import { PAUSE_MAX_DAYS_DEFAULT } from "@/lib/admin/pauses";
import { getOrderSettings, type OrderSettings } from "@/lib/data/catalog";
import { tashkentToday } from "@/lib/order/days";
import { DEFAULT_CUTOFF_HOUR, DEFAULT_DELIVERY_WINDOWS } from "@/lib/order/rules";
import { pageMetadata } from "@/lib/seo";
import { AccountAnalytics, NameForm, SignOutButton } from "./AccountForms";
import { DeliveryDetails } from "./DeliveryDetails";
import { PauseSheet, type PauseSheetLabels } from "./PauseSheet";

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

      {/* data-ph-mask: the saved address is never shown in session replays (src/lib/analytics/client.ts). */}
      <section aria-labelledby="delivery-details" className="rounded-3xl bg-white p-6 md:p-8" data-ph-mask>
        <h2 id="delivery-details" className="font-serif text-2xl text-forest md:text-3xl">
          {a.delivery.title}
        </h2>
        <Suspense fallback={<div className="mt-5 h-24 animate-pulse rounded-2xl bg-ivory-deep" aria-hidden />}>
          <SavedDelivery customerId={customer.id} locale={locale} t={t} />
        </Suspense>
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

/** The saved address, delivery time and courier note (migration 0030), to change or remove. */
async function SavedDelivery({ customerId, locale, t }: { customerId: string; locale: Locale; t: Dictionary }) {
  const d = t.account.delivery;
  const [saved, windows] = await Promise.all([
    readSavedDelivery(customerId),
    getOrderSettings().then(
      (settings) => settings.deliveryWindows,
      (error: unknown) => {
        console.error("account: settings unavailable", errorMessage(error));
        return DEFAULT_DELIVERY_WINDOWS;
      },
    ),
  ]);
  if (saved === "failed") {
    return (
      <p role="alert" className="mt-4 rounded-2xl bg-danger/10 p-4 text-danger">
        {d.readFailed}
      </p>
    );
  }
  return <DeliveryDetails locale={locale} saved={saved} windows={windows} t={d} />;
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

  // The status line and the Renew button come from the order's own dates (src/lib/account/order-status.ts). Renew and
  // "Repeat last order" open the order form with ?repeat=<number>: the form reads the rest of the order on the server.
  const today = tashkentToday();
  let settings: Pick<OrderSettings, "cutoffHour" | "pauseMaxDays"> = {
    cutoffHour: DEFAULT_CUTOFF_HOUR,
    pauseMaxDays: PAUSE_MAX_DAYS_DEFAULT,
  };
  try {
    settings = await getOrderSettings();
  } catch (error) {
    console.error("account: settings unavailable", errorMessage(error));
  }
  // The first day a customer may pause or remove a pause: the earliest start of a new order placed now (0029).
  const firstPauseDay = customerFirstPauseDay(new Date(), settings.cutoffHour);
  const pauseLabels: PauseSheetLabels = {
    ...a.pause,
    orderNumber: a.orderNumber,
    monthNames: o.monthNames,
    weekdayNames: o.weekdayNames,
    dayForms: o.dayForms,
  };
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
  const repeatHref = (order: CustomerOrder) => `/${locale}/order?repeat=${order.number}`;
  const cards = orders.map((order, index) => {
    const progress = orderProgress(order, today);
    // The pause sheet needs every pause's id (my_order_pauses_v2, 0029) to offer Remove and an end date it can trust.
    const pauses =
      order.pauses && order.pauses.every((pause) => pause.id) && hasDaysToPause(order, order.pauses, firstPauseDay)
        ? order.pauses
        : null;
    return {
      order,
      progress,
      pauses,
      // Only on an order that still runs: a cancelled or finished order keeps its pause rows, but they no longer apply.
      pauseLine:
        customerCanPause(order.status) && progress !== null && progress.kind !== "ended"
          ? upcomingPauses(order, today, o.monthNames)
          : null,
      renewHref: renewDue(progress, today) ? repeatHref(order) : null,
      // "Repeat last order" on the newest order (the list is newest first), unless it already offers Renew (the same link).
      repeatHref: index === 0 && !renewDue(progress, today) ? repeatHref(order) : null,
    };
  });
  // One gold order button per page: the first Renew when a card offers one, else "Repeat last order"; every other order
  // button (more Renews, Repeat beside a Renew, the general one) is outline.
  const goldRenew = cards.find((card) => card.renewHref)?.order.number ?? null;
  const renewing = goldRenew !== null;

  return (
    <>
      <ul className="mt-5 grid gap-3">
        {cards.map(({ order, progress, pauses, pauseLine, renewHref, repeatHref }) => (
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
            {pauseLine && (
              <p className="mt-1 text-sm text-muted tabular-nums" data-order-pauses>
                {a.pause.cardLine.replace("{ranges}", pauseLine)}
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
            {pauses && (
              <PauseSheet
                order={{
                  number: order.number,
                  status: order.status,
                  start_date: order.start_date,
                  days: order.days,
                  weekdays_only: order.weekdays_only,
                }}
                pauses={pauses}
                firstDay={firstPauseDay}
                cutoffHour={settings.cutoffHour}
                max={settings.pauseMaxDays}
                locale={locale}
                labels={pauseLabels}
              />
            )}
            {renewHref && (
              <Link
                href={renewHref}
                aria-label={`${a.renew}: ${order.program_name} ${order.kcal} ${o.kcal}`}
                className={`btn mt-4 min-h-12 w-full sm:w-auto ${
                  order.number === goldRenew ? "btn-gold" : "btn-outline text-forest"
                }`}
              >
                {a.renew}
              </Link>
            )}
            {repeatHref && (
              <Link
                href={repeatHref}
                aria-label={`${a.repeat}: ${a.orderNumber.replace("{n}", String(order.number))}`}
                className={`btn mt-4 min-h-12 w-full sm:w-auto ${renewing ? "btn-outline text-forest" : "btn-gold"}`}
                data-repeat-order
              >
                {a.repeat}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {/* One gold order button per page: with orders, Renew or "Repeat last order" above is it, so this one is outline;
          the empty and failed states above have the gold one. */}
      <Link href={`/${locale}/order`} className="btn btn-outline mt-5 min-h-12 text-forest">
        {a.orderCta}
      </Link>
      {telegramOn && <p className="mt-5 text-sm text-muted">{a.ordersNote}</p>}
    </>
  );
}

function errorMessage(error: unknown): unknown {
  return error instanceof Error ? error.message : error;
}

/** The order's pauses that end today or later, as "3–5 dek, 9 dek"; null when there are none. */
function upcomingPauses(order: CustomerOrder, today: string, monthNames: readonly string[]): string | null {
  const ahead = (order.pauses ?? []).filter((pause) => pause.to >= today).sort((x, y) => x.from.localeCompare(y.from));
  return ahead.length > 0 ? ahead.map((pause) => formatPauseRange(pause.from, pause.to, monthNames)).join(", ") : null;
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
