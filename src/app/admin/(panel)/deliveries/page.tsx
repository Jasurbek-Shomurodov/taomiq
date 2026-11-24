import { CalendarCheck, CalendarX, Hourglass, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { requireOrdersAccess } from "@/lib/admin/auth";
import { buildDeliverySheet, loadDeliveryDay, telHref, type DeliveryRow } from "@/lib/admin/deliveries";
import { sheetDate } from "@/lib/admin/kitchen";
import { formatDateTime, formatDay, formatPhone } from "@/lib/admin/orders";
import { Badge } from "../../kit/Badge";
import { DaySwitcher } from "../../kit/DaySwitcher";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { PrintButton, PrintTime } from "../../kit/PrintButton";
import { StatTile } from "../../kit/StatTile";
import { TopBarActions, TopBarTabs, TopBarTitle } from "../../shell/TopBarSlot";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOrdersAccess();
  return { title: getAdminDictionary(staff.locale).deliveries.title };
}

const DASH = "—";
const BASE_PATH = "/deliveries";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Sales → Deliveries (docs/plans/kitchen-day-sheet.md, slice 2): who gets a ration on a day, where and in which
 * window, by default tomorrow in Tashkent. Owners and managers only: the rows carry names, phones and addresses
 * (they come through public.delivery_orders, which returns rows to those two roles only, migration 0011). Customer
 * text is printed as typed, as plain text. A failed read prints "—" and a notice, never a made-up 0.
 */
export default async function DeliveriesPage({ searchParams }: PageProps<"/admin/deliveries">) {
  const { supabase, staff } = await requireOrdersAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const params = await searchParams;
  // Read the clock only after the session and the address (request-time reads), so it is the request's time.
  const now = new Date();
  const date = sheetDate(one(params.date), now);
  const data = await loadDeliveryDay(supabase, date.day);

  const sheet = buildDeliverySheet(data.orders ?? [], data.windows ?? [], locale);
  const dayText = formatDay(date.day, locale);
  const selfHref = `${BASE_PATH}?date=${date.day}`;
  const ordersOk = data.orders !== null;

  return (
    <div className="adm-page adm-sheet">
      <TopBarTitle>
        <span className="adm-truncate">
          {t.deliveries.title} · {dayText}
        </span>
      </TopBarTitle>
      <TopBarTabs>
        <DaySwitcher
          basePath={BASE_PATH}
          day={date.day}
          min={date.min}
          max={date.max}
          prev={date.prev}
          next={date.next}
          labels={{
            group: t.deliveries.switcher,
            date: t.deliveries.date,
            prev: t.deliveries.prevDay,
            next: t.deliveries.nextDay,
          }}
        />
      </TopBarTabs>
      <TopBarActions>
        <PrintButton label={t.deliveries.print} />
      </TopBarActions>

      {/* The top bar does not print: the sheet carries its own header line. */}
      <p className="adm-print-only adm-print-header">
        <strong>TAOMIQ</strong> · {t.deliveries.sheetName} · {dayText} · {t.deliveries.printed}{" "}
        <PrintTime initial={formatDateTime(now.toISOString(), locale)} locale={locale} />
      </p>

      {!ordersOk && (
        <Notice tone="negative" retry={{ href: selfHref, label: t.common.retry }}>
          {t.deliveries.ordersFailed}
        </Notice>
      )}
      {data.windows === null && <Notice tone="caution">{t.deliveries.windowsFailed}</Notice>}

      <div className="adm-sheet-tiles grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile
          label={t.deliveries.toDeliver}
          value={ordersOk ? sheet.firm : DASH}
          icon={Truck}
          footer={<span>{t.deliveries.toDeliverHint}</span>}
        />
        <StatTile
          label={t.deliveries.awaiting}
          value={ordersOk ? sheet.awaiting : DASH}
          icon={Hourglass}
          tone={sheet.awaiting > 0 ? "caution" : "accent"}
          footer={<span>{t.deliveries.awaitingHint}</span>}
        />
        <StatTile
          label={t.deliveries.lastDays}
          value={ordersOk ? sheet.lastDays : DASH}
          icon={CalendarCheck}
          tone={sheet.lastDays > 0 ? "caution" : "accent"}
          footer={<span>{ordersOk ? t.deliveries.firstDaysHint(sheet.firstDays) : DASH}</span>}
        />
      </div>

      {ordersOk && sheet.firm === 0 && (
        <Panel>
          <EmptyState icon={CalendarX} title={t.deliveries.empty(dayText)}>
            {sheet.awaiting > 0 ? t.deliveries.emptyAwaiting(sheet.awaiting) : undefined}
          </EmptyState>
        </Panel>
      )}

      {ordersOk &&
        sheet.groups.map((group) => (
          <Panel
            key={group.window}
            flush
            title={<span className="tabular-nums">{group.window}</span>}
            description={
              <>
                {t.deliveries.count(group.rows.length)}
                {!group.known && data.windows !== null ? ` · ${t.deliveries.otherWindow}` : ""}
              </>
            }
          >
            <DeliveryList rows={group.rows} t={t} tick />
          </Panel>
        ))}

      {ordersOk && sheet.awaitingRows.length > 0 && (
        <Panel
          flush
          className="adm-no-print"
          title={t.deliveries.awaitingTitle}
          description={t.deliveries.awaitingLead}
        >
          <DeliveryList rows={sheet.awaitingRows} t={t} showWindow />
        </Panel>
      )}
    </div>
  );
}

/**
 * The rows of one window: a table from the tablet width up and on paper, stacked cards on a phone. `tick` adds the
 * printed tick-box column; `showWindow` prints each row's window (for the list that is not grouped by window).
 */
function DeliveryList({
  rows,
  t,
  tick = false,
  showWindow = false,
}: {
  rows: DeliveryRow[];
  t: AdminDictionary;
  tick?: boolean;
  showWindow?: boolean;
}) {
  return (
    <>
      <table className="adm-delivery-table hidden w-full text-left text-sm md:table">
        <thead className="adm-table-head">
          <tr>
            {tick && (
              <th className="adm-print-cell adm-tick-cell px-3 py-2.5 text-center font-medium">{t.deliveries.tick}</th>
            )}
            <th className="px-3 py-2.5 font-medium sm:px-4">{t.deliveries.number}</th>
            <th className="px-3 py-2.5 font-medium sm:px-4">{t.deliveries.customer}</th>
            <th className="px-3 py-2.5 font-medium sm:px-4">{t.deliveries.address}</th>
            <th className="px-3 py-2.5 font-medium sm:px-4">{t.deliveries.program}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="adm-row align-top">
              {tick && (
                <td className="adm-print-cell adm-tick-cell px-3 py-3 text-center">
                  <span className="adm-tick" aria-hidden="true" />
                </td>
              )}
              <td className="px-3 py-3 sm:px-4">
                <OrderLink row={row} />
              </td>
              <td className="px-3 py-3 sm:px-4">
                <span className="block font-semibold text-adm-text">{row.customer_name}</span>
                <Phone phone={row.phone} />
              </td>
              <td className="px-3 py-3 sm:px-4">
                <span className="block whitespace-pre-line break-words text-adm-text">{row.address}</span>
                <Extras row={row} t={t} />
              </td>
              <td className="px-3 py-3 sm:px-4">
                <Program row={row} t={t} showWindow={showWindow} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="adm-delivery-cards md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="adm-row grid gap-1.5 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <OrderLink row={row} /> <span className="font-semibold text-adm-text">{row.customer_name}</span>
              </span>
              <Phone phone={row.phone} />
            </div>
            <span className="whitespace-pre-line break-words text-sm text-adm-text">{row.address}</span>
            <Extras row={row} t={t} />
            <Program row={row} t={t} showWindow={showWindow} />
          </li>
        ))}
      </ul>
    </>
  );
}

function OrderLink({ row }: { row: DeliveryRow }) {
  return (
    <Link
      href={`/orders/${row.id}`}
      className="font-semibold tabular-nums text-adm-accent-ink underline-offset-4 hover:underline"
    >
      #{row.number}
    </Link>
  );
}

function Phone({ phone }: { phone: string }) {
  return (
    <a
      href={telHref(phone)}
      className="block whitespace-nowrap text-[13px] tabular-nums text-adm-accent-ink underline-offset-4 hover:underline"
    >
      {formatPhone(phone)}
    </a>
  );
}

/** The customer's comment and exclusions and the owner's note, each only when there is one, as typed. */
function Extras({ row, t }: { row: DeliveryRow; t: AdminDictionary }) {
  const lines = [
    { key: "comment", label: t.deliveries.comment, text: row.comment.trim() },
    { key: "exclusions", label: t.deliveries.exclusions, text: row.exclusions.trim() },
    { key: "note", label: t.deliveries.note, text: row.staff_note.trim() },
  ].filter((line) => line.text !== "");
  if (lines.length === 0) return null;
  return (
    <span className="mt-1 grid gap-0.5 text-[13px]">
      {lines.map((line) => (
        <span key={line.key} className="block whitespace-pre-line break-words text-adm-muted">
          <span className="font-medium text-adm-text">{line.label}:</span> {line.text}
        </span>
      ))}
    </span>
  );
}

function Program({ row, t, showWindow }: { row: DeliveryRow; t: AdminDictionary; showWindow: boolean }) {
  return (
    <span className="grid gap-1 text-sm">
      <span>
        {row.program_name} / <span className="tabular-nums">{row.kcal}</span>
        {showWindow && <span className="tabular-nums text-adm-muted"> · {row.delivery_window}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="whitespace-nowrap text-[13px] tabular-nums text-adm-muted">
          {t.deliveries.dayOf(row.day_index, row.days)}
        </span>
        {row.firstDay && <Badge tone="info">{t.deliveries.firstDay}</Badge>}
        {row.lastDay && <Badge tone="caution">{t.deliveries.lastDay}</Badge>}
      </span>
    </span>
  );
}
