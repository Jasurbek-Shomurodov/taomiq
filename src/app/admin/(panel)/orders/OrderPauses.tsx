"use client";

import { useActionState, useState } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { cancelOrderPause, pauseOrder } from "@/lib/admin/order-actions";
import { formatDay, type Order } from "@/lib/admin/orders";
import {
  activeRanges,
  canCancelPause,
  canPause,
  firstPauseDay,
  previewPause,
  type OrderPause,
  type PauseError,
} from "@/lib/admin/pauses";
import { isPausedDay, orderEndDate, skippedDays, type DayRange } from "@/lib/order/days";
import { addDays, isWeekend } from "@/lib/order/rules";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { Panel } from "../../kit/Panel";

type PausableOrder = Pick<Order, "id" | "status" | "start_date" | "weekdays_only" | "days">;

function Result({ state }: { state: FormState }) {
  if (state.ok) return <p role="status" className="text-sm text-adm-positive">{state.ok}</p>;
  if (state.error) return <p role="alert" className="text-sm text-adm-negative">{state.error}</p>;
  return null;
}

function errorText(error: PauseError, max: number, t: AdminDictionary): string {
  return error === "pause_limit" ? t.order.pauses.limitReached(max) : t.order.pauses.errors[error];
}

/**
 * The order's paused delivery days (migration 0028): the last delivery day with and without the pauses, the pauses in
 * force (one that has not started can be removed), and "Pause days", a picker of this order's delivery days. The
 * preview uses the database's day rule (src/lib/order/days.ts); the database checks everything again on save.
 */
export function OrderPauses({
  order,
  pauses,
  max,
  today,
  locale,
}: {
  order: PausableOrder;
  pauses: OrderPause[];
  /** The cap of paused delivery days per order (settings pause_max_days). */
  max: number;
  /** Tashkent today, YYYY-MM-DD. */
  today: string;
  locale: Locale;
}) {
  const t = getAdminDictionary(locale);
  const p = t.order.pauses;
  const ranges = activeRanges(pauses);
  const active = pauses.filter((pause) => !pause.cancelled_at);
  const plainEnd = orderEndDate(order.start_date, order.weekdays_only, order.days);
  const end = orderEndDate(order.start_date, order.weekdays_only, order.days, ranges);
  const skipped = skippedDays(order.start_date, order.weekdays_only, order.days, ranges);
  const pausable = canPause(order.status);
  // Days left to pause: the order still delivers on the first day a pause may start or later.
  const hasDaysLeft = end !== null && end >= firstPauseDay(today);

  return (
    <Panel title={p.title} description={p.description}>
      <div className="grid gap-4">
        {end && (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[11rem_1fr]">
            <dt className="text-sm text-adm-muted">{p.lastDelivery}</dt>
            <dd className="text-adm-text">
              {skipped > 0 && plainEnd
                ? p.endsInstead(formatDay(end, locale), formatDay(plainEnd, locale))
                : formatDay(end, locale)}
            </dd>
          </dl>
        )}

        {active.length === 0 ? (
          <p className="text-adm-muted">{p.none}</p>
        ) : (
          <ul className="grid gap-2">
            {active.map((pause) => (
              <PauseRow
                key={pause.id}
                pause={pause}
                removable={pausable && canCancelPause(pause, today)}
                locale={locale}
                t={t}
              />
            ))}
          </ul>
        )}
        {(skipped > 0 || active.length > 0) && <p className="adm-caption">{p.skipped(skipped, max)}</p>}

        {pausable ? (
          hasDaysLeft && <AddPause order={order} ranges={ranges} end={end} max={max} today={today} locale={locale} />
        ) : (
          <p className="adm-caption">{p.notPausable}</p>
        )}
      </div>
    </Panel>
  );
}

function rangeText(from: string, to: string, locale: Locale, t: AdminDictionary): string {
  return t.order.pauses.range(formatDay(from, locale), formatDay(to, locale));
}

function PauseRow({
  pause,
  removable,
  locale,
  t,
}: {
  pause: OrderPause;
  removable: boolean;
  locale: Locale;
  t: AdminDictionary;
}) {
  const p = t.order.pauses;
  const [state, action, pending] = useActionState<FormState, FormData>(cancelOrderPause, {});
  const range = rangeText(pause.from_date, pause.to_date, locale, t);
  return (
    <li className="grid gap-1 rounded-adm-btn border border-adm-border px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="tabular-nums text-adm-text">
          {range}
          {pause.source === "customer" && <span className="adm-caption"> · {p.byCustomer}</span>}
          {!removable && <span className="adm-caption"> · {p.started}</span>}
        </p>
        {removable && (
          <form action={action}>
            <input type="hidden" name="pause_id" value={pause.id} />
            <ConfirmDialog
              trigger={pending ? t.common.saving : p.remove}
              triggerClassName="adm-btn adm-btn-outline adm-btn-sm"
              disabled={pending}
              title={p.removeTitle}
              description={p.removeText(range)}
              confirmLabel={p.remove}
              pendingLabel={t.common.saving}
              cancelLabel={p.removeKeep}
              pending={pending}
            />
          </form>
        )}
      </div>
      <div aria-live="polite">
        <Result state={state} />
      </div>
    </li>
  );
}

type Cell = { day: string; kind: "out" | "delivery" | "paused" };

/** Monday-first weeks from the week of `first` to the week of `last`, each day marked for the picker. */
function calendarWeeks(
  order: PausableOrder,
  ranges: readonly DayRange[],
  first: string,
  last: string,
): Cell[][] {
  const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const weeks: Cell[][] = [];
  let day = addDays(first, -weekday(first));
  const stop = addDays(last, 6 - weekday(last));
  while (day <= stop) {
    const week: Cell[] = [];
    for (let i = 0; i < 7; i++) {
      const scheduled = day >= first && day <= last && !(order.weekdays_only && isWeekend(day));
      week.push({ day, kind: !scheduled ? "out" : isPausedDay(ranges, day) ? "paused" : "delivery" });
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function AddPause({
  order,
  ranges,
  end,
  max,
  today,
  locale,
}: {
  order: PausableOrder;
  ranges: DayRange[];
  end: string;
  max: number;
  today: string;
  locale: Locale;
}) {
  const t = getAdminDictionary(locale);
  const p = t.order.pauses;
  const [state, action, pending] = useActionState<FormState, FormData>(pauseOrder, {});
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  // Tomorrow at the earliest (staff_pause_order), or the start when it is later.
  const tomorrow = firstPauseDay(today);
  const first = order.start_date > tomorrow ? order.start_date : tomorrow;
  const weeks = calendarWeeks(order, ranges, first, end);
  const check = from && to ? previewPause(order, ranges, from, to, today, max) : null;
  const preview = check?.preview;

  function pick(day: string) {
    // First tap: one day. A later day then extends it to a range; anything else starts again.
    if (!from || from !== to || day < from) {
      setFrom(day);
      setTo(day);
    } else {
      setTo(day);
    }
  }

  return (
    <div className="grid gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={order.id} />
        <input type="hidden" name="from" value={from ?? ""} />
        <input type="hidden" name="to" value={to ?? ""} />
        <ConfirmDialog
          trigger={pending ? t.common.saving : p.add}
          triggerClassName="adm-btn adm-btn-outline"
          disabled={pending}
          title={p.pickTitle}
          description={p.pickText}
          confirmLabel={p.confirm}
          pendingLabel={t.common.saving}
          cancelLabel={t.common.cancel}
          pending={pending}
          onOpen={() => {
            setFrom(null);
            setTo(null);
          }}
          confirmDisabled={!check?.ok}
        >
          <div className="grid gap-3">
            <p className="adm-caption">{p.pickHint}</p>
            <div className="max-h-[45vh] overflow-y-auto" role="group" aria-label={p.calendarAria}>
              <div className="grid grid-cols-7 gap-1 text-center">
                {p.weekdays.map((name) => (
                  <span key={name} className="text-xs font-semibold text-adm-muted" aria-hidden="true">
                    {name}
                  </span>
                ))}
                {weeks.flat().map((cell) => {
                  const label = cell.day.slice(8, 10) + "." + cell.day.slice(5, 7);
                  if (cell.kind === "out") {
                    return <span key={cell.day} aria-hidden="true" className="min-h-10" />;
                  }
                  const selected = from !== null && to !== null && cell.day >= from && cell.day <= to;
                  if (cell.kind === "paused") {
                    return (
                      <span
                        key={cell.day}
                        title={`${formatDay(cell.day, locale)} · ${p.legendPaused}`}
                        className={`flex min-h-10 items-center justify-center rounded-adm-btn text-xs tabular-nums text-adm-muted line-through ${selected ? "bg-adm-accent-tint" : ""}`}
                      >
                        <span className="sr-only">
                          {formatDay(cell.day, locale)}, {p.legendPaused}
                        </span>
                        <span aria-hidden="true">{label}</span>
                      </span>
                    );
                  }
                  return (
                    <button
                      key={cell.day}
                      type="button"
                      onClick={() => pick(cell.day)}
                      disabled={pending}
                      aria-pressed={selected}
                      aria-label={formatDay(cell.day, locale)}
                      className={`min-h-10 rounded-adm-btn border text-xs font-semibold tabular-nums ${
                        selected
                          ? "border-adm-accent bg-adm-accent text-adm-on-accent"
                          : "border-adm-border text-adm-text hover:bg-adm-accent-tint"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div aria-live="polite" className="grid gap-1 text-sm">
              {from && to && <p className="font-semibold text-adm-text">{rangeText(from, to, locale, t)}</p>}
              {preview && preview.endAfter && preview.endBefore && preview.endAfter !== preview.endBefore && (
                <p className="text-adm-text">
                  {p.previewEnd(formatDay(preview.endAfter, locale), formatDay(preview.endBefore, locale))}
                </p>
              )}
              {preview && preview.added > 0 && <p className="text-adm-muted">{p.previewAdded(preview.added)}</p>}
              {check && !check.ok && <p className="text-adm-negative">{errorText(check.error, max, t)}</p>}
            </div>
          </div>
        </ConfirmDialog>
      </form>
      <div aria-live="polite">
        <Result state={state} />
      </div>
    </div>
  );
}
