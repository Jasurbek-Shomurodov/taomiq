import { CalendarX2, Scale } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createElement, type ReactNode } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { isPaymentMethod } from "@/lib/admin/finance/categories";
import { balanceState, daysInMonth, monthlySpread, rateGap, type PayrollRow } from "@/lib/admin/finance/math";
import { formatEntryDay } from "@/lib/admin/finance/month";
import { EVENT_TONES, eventIcon, PAYROLL_LIMITS } from "@/lib/admin/finance/payroll";
import {
  EVENTS_CAP,
  loadEmployeeHistory,
  loadPayroll,
  type SalaryEvent,
  type SalaryRate,
} from "@/lib/admin/finance/queries";
import { addDays, tashkentDay } from "@/lib/admin/stats";
import { Badge } from "../../../../kit/Badge";
import { BeforeHydration } from "../../../../kit/BeforeHydration";
import { EmptyState } from "../../../../kit/EmptyState";
import { Notice } from "../../../../kit/Notice";
import { Panel } from "../../../../kit/Panel";
import { StatTile } from "../../../../kit/StatTile";
import { TopBarBack, TopBarTitle } from "../../../../shell/TopBarSlot";
import { FinanceTabs } from "../../FinanceTabs";
import { DASH, Indicator, Labeled, Money, sumText } from "../../figures";
import { BalanceBadge, rateLine } from "../parts";
import { DeletePayrollItem } from "./DeletePayrollItem";
import { Employment } from "./Employment";
import { EventForm } from "./EventForm";
import { RateForm } from "./RateForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale).finance;
  return { title: `${t.tabs.payroll} · ${t.title}` };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Finance → Payroll → one person (slice 3): what they have earned, been given and been paid, and what that leaves
 * (owed or advance); the forms for a payment, bonus, fine or absence and for a new rate; the history of events and
 * rates, each deletable after asking; and their leaving (or coming back). The figures come from
 * public.finance_payroll(today), the lists from the tables through RLS. A failed history read keeps the figures and
 * the forms.
 */
export default async function EmployeePage({ params }: PageProps<"/admin/finance/payroll/[id]">) {
  const { id } = await params;
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const p = t.finance.payroll;
  if (!UUID_RE.test(id)) notFound();
  // Read the clock only after the session and the address (request-time reads).
  const today = tashkentDay(new Date())!;
  const selfHref = `/finance/payroll/${id}`;

  const [rows, history] = await Promise.all([
    loadPayroll(supabase, today).catch((error: unknown) => {
      console.error("finance payroll failed", error instanceof Error ? error.message : error);
      return null;
    }),
    loadEmployeeHistory(supabase, id).catch((error: unknown) => {
      console.error("finance payroll history failed", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);

  if (!rows) {
    return (
      <div className="adm-page">
        <TopBarBack href="/finance/payroll" label={p.back} />
        <BeforeHydration>
          <FinanceTabs locale={locale} />
        </BeforeHydration>
        <Notice tone="negative" retry={{ href: selfHref, label: t.common.retry }}>
          {p.loadFailed}
        </Notice>
      </div>
    );
  }
  const row = rows.find((candidate) => candidate.employee_id === id);
  if (!row) notFound();

  const since = formatEntryDay(row.joined_at, locale);
  // Days no rate covers (a deleted or late first rate) earn nothing: say which.
  const gap = rateGap(row);
  // A leaving can be undone only within a few days of the last working day (a mistake); 0014 enforces it too.
  const canResume = !row.ended_at || row.ended_at >= addDays(today, -PAYROLL_LIMITS.resumeDays);

  return (
    <div className="adm-page">
      <TopBarBack href="/finance/payroll" label={p.back} />
      <TopBarTitle>
        <span className="adm-truncate" data-ph-mask>
          {row.name}
        </span>
      </TopBarTitle>
      <BeforeHydration>
        <FinanceTabs locale={locale} />
      </BeforeHydration>

      <p className="adm-caption">{[row.job_title, p.since(since)].filter(Boolean).join(" · ")}</p>
      {row.ended_at && <Notice tone="info">{p.endedNote(formatEntryDay(row.ended_at, locale))}</Notice>}
      {row.first_rate_from === null ? (
        <Notice tone="caution">{p.noRateHint}</Notice>
      ) : (
        gap && <Notice tone="caution">{p.rateGap(formatEntryDay(gap.from, locale), formatEntryDay(gap.to, locale))}</Notice>
      )}

      <Figures row={row} today={today} locale={locale} t={t} />

      <Panel title={p.eventTitle} description={p.eventLead}>
        <EventForm employeeId={row.employee_id} locale={locale} today={today} />
      </Panel>

      {!history ? (
        <Notice tone="negative" retry={{ href: selfHref, label: t.common.retry }}>
          {p.historyFailed}
        </Notice>
      ) : (
        <>
          <Panel
            flush
            title={p.historyTitle}
            description={history.events.length > 0 ? p.historyCount(history.events.length) : p.historyLead}
          >
            {history.partial && (
              <div className="px-4 pt-3 sm:px-5">
                <Notice tone="caution">{p.historyPartial(formatSum(EVENTS_CAP))}</Notice>
              </div>
            )}
            {history.events.length === 0 ? (
              <EmptyState icon={CalendarX2}>{p.historyEmpty}</EmptyState>
            ) : (
              <ul>
                {history.events.map((event) => (
                  <EventRow key={event.id} event={event} locale={locale} t={t} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={p.rateTitle} description={p.rateLead}>
            <RateForm
              employeeId={row.employee_id}
              defaultUnit={row.rate_unit ?? "monthly"}
              locale={locale}
              today={today}
              latest={addDays(today, PAYROLL_LIMITS.rateAheadDays)}
            />
          </Panel>

          <Panel flush title={p.ratesTitle}>
            {history.rates.length === 0 ? (
              <EmptyState icon={Scale}>{p.noRateHint}</EmptyState>
            ) : (
              <ul>
                {history.rates.map((rate) => (
                  <RateRow key={rate.id} rate={rate} current={row} today={today} locale={locale} t={t} />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      <Panel title={p.endTitle} description={p.endLead}>
        <Employment
          employeeId={row.employee_id}
          name={row.name}
          joinedAt={row.joined_at}
          endedAt={row.ended_at}
          canResume={canResume}
          locale={locale}
          today={today}
        />
      </Panel>
    </div>
  );
}

/** A figure without a "?": caption, value, an optional line. */
function Plain({ label, value, valueClass = "" }: { label: ReactNode; value: ReactNode; valueClass?: string }) {
  return (
    <div className="grid content-start gap-1">
      <dt className="adm-caption font-medium">{label}</dt>
      <dd className={`whitespace-nowrap text-xl font-semibold tabular-nums text-adm-text ${valueClass}`}>{value}</dd>
    </div>
  );
}

function Figures({ row, today, locale, t }: { row: PayrollRow; today: string; locale: Locale; t: AdminDictionary }) {
  const p = t.finance.payroll;
  const state = balanceState(row.balance);
  const spread =
    row.rate_amount !== null && row.rate_unit === "monthly" ? monthlySpread(row.rate_amount, daysInMonth(today)) : null;

  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile
          label={
            <Labeled topic={state.kind === "advance" ? "advance" : "due"} locale={locale}>
              {state.kind === "advance" ? p.balance.advance : p.balance.due}
            </Labeled>
          }
          value={<Money value={state.amount} t={t} className={state.kind === "advance" ? "text-adm-info" : ""} />}
          icon={Scale}
          tone={state.kind === "due" ? "caution" : state.kind === "advance" ? "info" : "accent"}
          footer={<BalanceBadge balance={row.balance} t={t} />}
        />
        <StatTile
          label={<Labeled topic="monthlyRate" locale={locale}>{p.currentRate}</Labeled>}
          value={
            row.rate_amount === null ? (
              DASH
            ) : (
              <Money value={row.rate_amount} t={t} />
            )
          }
          footer={
            row.rate_amount !== null && row.rate_unit && row.rate_from ? (
              <span className="grid gap-0.5">
                <span>
                  {p.units[row.rate_unit]} · {p.rateSince(formatEntryDay(row.rate_from, locale))}
                </span>
                {spread && <span>{p.spread(sumText(spread.base, t), spread.extra, sumText(spread.base + 1, t))}</span>}
              </span>
            ) : undefined
          }
        />
      </div>

      <Panel>
        <dl className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">
          <Indicator
            topic="accrued"
            label={p.accrued}
            value={sumText(row.accrued, t)}
            hint={p.accruedHint(formatEntryDay(row.joined_at, locale))}
            locale={locale}
          />
          <Plain
            label={p.bonuses}
            value={row.bonuses > 0 ? `+${sumText(row.bonuses, t)}` : sumText(0, t)}
            valueClass={row.bonuses > 0 ? "text-adm-positive" : ""}
          />
          <Plain label={p.fines} value={sumText(-row.fines, t)} valueClass={row.fines > 0 ? "text-adm-negative" : ""} />
          <Plain label={p.paid} value={sumText(-row.paid, t)} />
          <Indicator
            topic="monthPay"
            label={p.monthPayOne}
            value={sumText(row.month_pay, t)}
            hint={rateLine(row.rate_amount, row.rate_unit, t)}
            locale={locale}
          />
        </dl>
      </Panel>
    </>
  );
}

function EventRow({ event, locale, t }: { event: SalaryEvent; locale: Locale; t: AdminDictionary }) {
  const p = t.finance.payroll;
  const name = p.kinds[event.kind];
  const method =
    event.kind === "payment" && event.payment_method && isPaymentMethod(event.payment_method)
      ? t.finance.methods[event.payment_method]
      : null;
  const amount =
    event.amount === null
      ? null
      : event.kind === "bonus"
        ? `+${sumText(event.amount, t)}`
        : event.kind === "fine"
          ? sumText(-event.amount, t)
          : sumText(event.amount, t);
  const day = formatEntryDay(event.event_date, locale);
  const summary = [name, event.amount === null ? null : sumText(event.amount, t), day].filter(Boolean).join(" · ");
  const amountClass =
    event.kind === "bonus" ? "text-adm-positive" : event.kind === "fine" ? "text-adm-negative" : "text-adm-text";

  return (
    <li className="adm-row flex items-start gap-3 px-4 py-3 sm:px-5">
      <span
        className={`adm-tone-${EVENT_TONES[event.kind]} mt-0.5 grid size-9 shrink-0 place-items-center rounded-adm-control`}
      >
        {createElement(eventIcon(event.kind), { "aria-hidden": true, className: "size-4" })}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-adm-text">{name}</p>
        <p className="adm-caption tabular-nums">{[day, method].filter(Boolean).join(" · ")}</p>
        {event.note && (
          <p className="adm-caption mt-1 whitespace-pre-line break-words" data-ph-mask>
            {event.note}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-start gap-2">
        {amount && <span className={`whitespace-nowrap pt-1.5 font-semibold tabular-nums ${amountClass}`}>{amount}</span>}
        <DeletePayrollItem id={event.id} item="event" summary={summary} locale={locale} />
      </div>
    </li>
  );
}

function RateRow({
  rate,
  current,
  today,
  locale,
  t,
}: {
  rate: SalaryRate;
  current: PayrollRow;
  today: string;
  locale: Locale;
  t: AdminDictionary;
}) {
  const p = t.finance.payroll;
  const text = rateLine(rate.amount, rate.rate_unit, t);
  const day = formatEntryDay(rate.effective_from, locale);
  const inForce = current.rate_from === rate.effective_from;
  const ahead = rate.effective_from > today;
  return (
    <li className="adm-row flex items-start gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold tabular-nums text-adm-text">
          {text}
          {inForce && <Badge tone="positive">{p.inForce}</Badge>}
          {ahead && <Badge tone="info">{p.upcoming}</Badge>}
        </p>
        <p className="adm-caption tabular-nums">{p.rateSince(day)}</p>
        {rate.note && (
          <p className="adm-caption mt-1 break-words" data-ph-mask>
            {rate.note}
          </p>
        )}
      </div>
      <DeletePayrollItem id={rate.id} item="rate" summary={`${text} · ${p.rateSince(day)}`} locale={locale} />
    </li>
  );
}
