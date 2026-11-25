import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { EQUIPMENT_HISTORY_LIMIT, type EquipmentEvent } from "@/lib/admin/equipment";
import { formatDateTime } from "@/lib/admin/orders";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";

/**
 * An item's history (public.equipment_events, written by the database on every change): who, when and what, newest
 * first. `events` is null when the read failed.
 */
export function EquipmentHistory({
  events,
  locale,
  retryHref,
}: {
  events: EquipmentEvent[] | null;
  locale: Locale;
  retryHref: string;
}) {
  const t = getAdminDictionary(locale);
  const h = t.equipment.history;
  return (
    <Panel title={h.title} description={h.lead}>
      {events === null ? (
        <Notice tone="negative" retry={{ href: retryHref, label: t.common.retry }}>
          {h.failed}
        </Notice>
      ) : events.length === 0 ? (
        <p className="text-adm-muted">{h.empty}</p>
      ) : (
        <>
          <ol className="grid gap-4">
            {events.map((event) => (
              <li key={event.id} className="grid gap-1 border-l-2 border-adm-border pl-3">
                <p className="text-[13px] tabular-nums text-adm-muted">
                  <time dateTime={event.at}>{formatDateTime(event.at, locale)}</time> · {actorLabel(event, t)}
                </p>
                <p className="break-words text-adm-text">{eventText(event, t)}</p>
              </li>
            ))}
          </ol>
          {events.length >= EQUIPMENT_HISTORY_LIMIT && <p className="adm-caption mt-4">{h.limited(EQUIPMENT_HISTORY_LIMIT)}</p>}
        </>
      )}
    </Panel>
  );
}

function actorLabel(event: EquipmentEvent, t: AdminDictionary): string {
  if (event.actor_name.trim()) return event.actor_name.trim();
  return event.actor ? t.audit.actorStaff : t.audit.actorSystem;
}

function numberOf(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
}

function textOf(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "—";
}

function eventText(event: EquipmentEvent, t: AdminDictionary): string {
  const h = t.equipment.history;
  const d = event.detail;
  switch (event.kind) {
    case "added":
      return h.added(numberOf(d.count));
    case "counted":
      return h.counted(numberOf(d.from), numberOf(d.to));
    case "confirmed":
      return h.confirmed(numberOf(d.count));
    case "renamed":
      return h.renamed(textOf(d.from), textOf(d.to));
    case "archived":
      return h.archived;
    case "restored":
      return h.restored;
  }
}
