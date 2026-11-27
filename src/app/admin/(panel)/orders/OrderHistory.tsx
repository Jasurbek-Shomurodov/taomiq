import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import {
  EDITED_FIELDS,
  formatDateTime,
  formatDay,
  formatPhone,
  isOrderStatus,
  isPaymentMethod,
  type EditedField,
  type OrderEvent,
} from "@/lib/admin/orders";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";

/**
 * The order's history (public.order_events, written by the database on every change): who, when and what, newest
 * first. `events` is null when the read failed. Personal data (old and new contact values): rendered only on the
 * order page (owners and managers).
 */
export function OrderHistory({
  events,
  locale,
  retryHref,
}: {
  events: OrderEvent[] | null;
  locale: Locale;
  retryHref: string;
}) {
  const t = getAdminDictionary(locale);
  return (
    <Panel title={t.order.history} description={t.order.historyBefore}>
      {events === null ? (
        <Notice tone="negative" retry={{ href: retryHref, label: t.common.retry }}>
          {t.order.historyFailed}
        </Notice>
      ) : events.length === 0 ? (
        <p className="text-adm-muted">{t.order.historyEmpty}</p>
      ) : (
        <ol className="grid gap-4">
          {events.map((event) => (
            <li key={event.id} className="grid gap-1 border-l-2 border-adm-border pl-3">
              <p className="text-[13px] tabular-nums text-adm-muted">
                <time dateTime={event.at}>{formatDateTime(event.at, locale)}</time> · {actorLabel(event, t)}
              </p>
              <EventBody event={event} locale={locale} t={t} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** The pause of an edit event (migration 0028): { action, from, to, source, end }, or null. */
function pauseOf(event: OrderEvent): { action: string; from: string; to: string; source: unknown; end: unknown } | null {
  const pause = event.kind === "edited" ? event.detail?.pause : undefined;
  if (!pause || typeof pause !== "object") return null;
  const { action, from, to, source, end } = pause as Record<string, unknown>;
  if (typeof action !== "string" || typeof from !== "string" || typeof to !== "string") return null;
  return { action, from, to, source, end };
}

function actorLabel(event: OrderEvent, t: AdminDictionary): string {
  if (event.actor_name) return event.actor_name;
  if (pauseOf(event)?.source === "customer") return t.order.pauses.events.byCustomer;
  if (event.actor) return t.order.actorStaff;
  // No signed-in person: the site's order (service key) or a change made outside the app.
  return event.kind === "created" && event.detail.by === "site" ? t.order.actorSite : t.order.actorSystem;
}

function statusName(value: unknown, t: AdminDictionary): string {
  return typeof value === "string" && isOrderStatus(value) ? t.orders.statuses[value] : "—";
}

function methodName(value: unknown, t: AdminDictionary): string {
  return isPaymentMethod(value) ? t.finance.methods[value] : t.order.noPaymentMethod;
}

/** One edited field's value as shown: dates and phones formatted, yes / no, "empty" for "". */
function fieldValue(field: EditedField, value: unknown, locale: Locale, t: AdminDictionary): string {
  if (field === "weekdays_only") return value === true ? t.order.yes : t.order.no;
  if (typeof value !== "string" || value === "") return t.order.empty;
  if (field === "start_date") return formatDay(value, locale);
  if (field === "phone") return formatPhone(value);
  return value;
}

function EventBody({ event, locale, t }: { event: OrderEvent; locale: Locale; t: AdminDictionary }) {
  const e = t.order.events;
  const detail = event.detail ?? {};

  if (event.kind === "created") {
    return <p className="text-adm-text">{detail.by === "staff" ? e.createdStaff : e.createdSite}</p>;
  }

  if (event.kind === "status") {
    return (
      <div className="grid gap-0.5">
        <p className="text-adm-text">{e.status(statusName(event.from_status, t), statusName(event.to_status, t))}</p>
        {event.to_status === "paid" && detail.payment_method !== undefined && (
          <p className="text-sm text-adm-muted">{e.paidWith(methodName(detail.payment_method, t))}</p>
        )}
        {event.to_status === "cancelled" && typeof detail.reason === "string" && detail.reason && (
          <p className="whitespace-pre-line break-words text-sm text-adm-muted">{e.reason(detail.reason)}</p>
        )}
      </div>
    );
  }

  if (event.kind === "payment_method") {
    return <p className="text-adm-text">{e.payment(methodName(detail.from, t), methodName(detail.to, t))}</p>;
  }

  if (event.kind === "note") {
    return <p className="text-adm-text">{e.note}</p>;
  }

  const pause = pauseOf(event);
  if (pause) {
    const p = t.order.pauses;
    const range = p.range(formatDay(pause.from, locale), formatDay(pause.to, locale));
    return (
      <div className="grid gap-0.5">
        <p className="text-adm-text">{pause.action === "cancelled" ? p.events.cancelled(range) : p.events.added(range)}</p>
        {typeof pause.end === "string" && pause.end && (
          <p className="text-sm text-adm-muted">{p.events.end(formatDay(pause.end, locale))}</p>
        )}
      </div>
    );
  }

  // edited: { field: { from, to } }
  const changes = EDITED_FIELDS.flatMap((field) => {
    const change = detail[field];
    if (!change || typeof change !== "object") return [];
    const { from, to } = change as { from?: unknown; to?: unknown };
    return [{ field, from: fieldValue(field, from, locale, t), to: fieldValue(field, to, locale, t) }];
  });
  return (
    <div className="grid gap-1">
      <p className="text-adm-text">{e.edited}</p>
      {detail.account_unlinked === true && <p className="text-sm text-adm-muted">{e.accountUnlinked}</p>}
      {changes.length > 0 && (
        <dl className="grid gap-1 text-sm">
          {changes.map((change) => (
            <div key={change.field} className="grid gap-x-3 sm:grid-cols-[9rem_1fr]">
              <dt className="text-adm-muted">{t.order.fields[change.field]}</dt>
              <dd className="break-words text-adm-text">
                <span className="text-adm-muted line-through decoration-adm-border">{change.from}</span>
                {" → "}
                {change.to}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
