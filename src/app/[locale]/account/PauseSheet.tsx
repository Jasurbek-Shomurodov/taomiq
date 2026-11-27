"use client";

import { useActionState, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { Dictionary } from "@/i18n";
import { plural, type Locale } from "@/i18n/config";
import type { OrderStatus } from "@/lib/admin/orders";
import { cancelMyPause, pauseMyOrder, type PauseState } from "@/lib/account/pause-actions";
import {
  customerCanRemove,
  formatPauseRange,
  formatShortDay,
  previewCustomerPause,
  type CustomerPause,
} from "@/lib/account/pauses";
import { isPausedDay, orderEndDate, type DayRange } from "@/lib/order/days";
import { addDays, isWeekend } from "@/lib/order/rules";

export type PauseSheetLabels = Dictionary["account"]["pause"] & {
  orderNumber: string;
  monthNames: readonly string[];
  /** Sunday first, as the order form's. */
  weekdayNames: readonly string[];
  dayForms: Dictionary["order"]["dayForms"];
};

export type PauseSheetOrder = {
  number: number;
  status: OrderStatus;
  start_date: string;
  days: number;
  weekdays_only: boolean;
};

type Cell = { day: string; kind: "out" | "delivery" | "paused" };

/** Monday-first weeks from the week of `first` to the week of `last`, each day marked for the picker. */
function calendarWeeks(order: PauseSheetOrder, ranges: readonly DayRange[], first: string, last: string): Cell[][] {
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

/**
 * "Pause or skip days" on a running order of the account (migration 0029; docs/plans/pause-and-skip-days.md, slice 3):
 * a native modal <dialog>, a bottom sheet on phones and a centred modal from md (the dish sheet's styles, globals.css
 * .dish-sheet). It holds a calendar of this order's delivery days from the first day a customer may change, a live
 * preview of the new last delivery, the cutoff rule, and the order's pauses with "Remove" for the customer's own ones
 * that are not locked yet. The preview uses the database's day rule (src/lib/order/days.ts); the database checks
 * everything again on save (public.pause_my_order / cancel_my_pause).
 */
export function PauseSheet({
  order,
  pauses,
  firstDay,
  cutoffHour,
  max,
  locale,
  labels: p,
}: {
  order: PauseSheetOrder;
  pauses: CustomerPause[];
  /** The first day a pause may start or still be removed (YYYY-MM-DD, Tashkent). */
  firstDay: string;
  cutoffHour: number;
  /** The cap of paused delivery days per order. */
  max: number;
  locale: Locale;
  labels: PauseSheetLabels;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  // The message of whichever action ran last.
  const [last, setLast] = useState<"pause" | "remove" | null>(null);

  const [pauseState, pauseAction, pausing] = useActionState<PauseState, FormData>(async (prev, form) => {
    const result = await pauseMyOrder(prev, form);
    setLast("pause");
    if (result.ok) {
      setFrom(null);
      setTo(null);
    }
    return result;
  }, {});
  const [removeState, removeAction] = useActionState<PauseState, FormData>(async (prev, form) => {
    const result = await cancelMyPause(prev, form);
    setLast("remove");
    return result;
  }, {});
  const result = last === "pause" ? pauseState : last === "remove" ? removeState : {};

  const short = (iso: string) => formatShortDay(iso, p.monthNames);
  const range = (a: string, b: string) => formatPauseRange(a, b, p.monthNames);
  const end = orderEndDate(order.start_date, order.weekdays_only, order.days, pauses);
  const first = order.start_date > firstDay ? order.start_date : firstDay;
  const weeks = end && end >= first ? calendarWeeks(order, pauses, first, end) : [];
  const selectable = weeks.some((week) => week.some((cell) => cell.kind === "delivery"));
  const check = from && to ? previewCustomerPause(order, pauses, from, to, firstDay, max) : null;
  const preview = check?.preview;
  const list = [...pauses].sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));
  // Monday first.
  const weekdays = [...p.weekdayNames.slice(1), p.weekdayNames[0]];
  const hour = String(cutoffHour);

  function previewError(): string | null {
    if (!check || check.ok) return null;
    const e = p.errors;
    switch (check.error) {
      case "pause_limit":
        return e.pause_limit.replace("{max}", String(max)).replace("{days}", plural(max, p.dayForms));
      case "pause_too_soon":
        return e.pause_too_soon.replace("{hour}", hour);
      default:
        return e[check.error];
    }
  }

  function pick(day: string) {
    // First tap: one day. A later day then extends it to a range; anything else starts again.
    if (!from || from !== to || day < from) {
      setFrom(day);
      setTo(day);
    } else {
      setTo(day);
    }
  }

  function open() {
    setFrom(null);
    setTo(null);
    setLast(null);
    dialog.current?.showModal();
  }

  const error = previewError();

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        onClick={open}
        className="btn btn-outline mt-4 min-h-12 w-full text-forest sm:w-auto"
      >
        {p.open}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        data-ph-mask
        onClick={(event) => {
          // A click on the dialog box itself, not its content, is a click on the backdrop.
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        onClose={() => trigger.current?.focus({ preventScroll: true })}
        className="dish-sheet bg-ivory text-graphite"
      >
        <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="label text-muted tabular-nums">{p.orderNumber.replace("{n}", String(order.number))}</p>
              <h2 id={titleId} className="mt-1 font-serif text-2xl leading-snug text-forest sm:text-3xl">
                {p.title}
              </h2>
            </div>
            <button
              type="button"
              aria-label={p.close}
              onClick={() => dialog.current?.close()}
              className="press -mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-forest hover:bg-ivory-deep"
            >
              <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-muted" data-pause-rule>
            {p.rule.replace("{hour}", hour).replace("{date}", short(first))}
          </p>

          {selectable && (
            <form action={pauseAction} className="mt-5">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="number" value={order.number} />
              <input type="hidden" name="from" value={from ?? ""} />
              <input type="hidden" name="to" value={to ?? ""} />
              <p className="text-sm text-graphite">{p.hint}</p>
              <div
                className="mt-3 max-h-[42dvh] overflow-y-auto rounded-2xl border border-line bg-white p-2"
                role="group"
                aria-label={p.calendar}
              >
                <div className="grid grid-cols-7 gap-1 text-center">
                  {weekdays.map((name) => (
                    <span key={name} className="py-1 text-xs font-semibold text-muted" aria-hidden="true">
                      {name}
                    </span>
                  ))}
                  {weeks.flat().map((cell, index) => {
                    if (cell.kind === "out") return <span key={cell.day} aria-hidden="true" className="min-h-11" />;
                    const date = Number(cell.day.slice(8, 10));
                    // The month under the first shown day and under each 1st.
                    const showMonth = date === 1 || weeks.flat().findIndex((c) => c.kind !== "out") === index;
                    const month = showMonth ? p.monthNames[Number(cell.day.slice(5, 7)) - 1] : null;
                    const selected = from !== null && to !== null && cell.day >= from && cell.day <= to;
                    if (cell.kind === "paused") {
                      return (
                        <span
                          key={cell.day}
                          data-day={cell.day}
                          className={`flex min-h-11 flex-col items-center justify-center rounded-xl text-sm tabular-nums text-muted line-through ${selected ? "bg-ivory-deep" : ""}`}
                        >
                          <span className="sr-only">
                            {short(cell.day)}, {p.paused}
                          </span>
                          <span aria-hidden="true">{date}</span>
                          {month && <span aria-hidden="true" className="text-[0.65rem] leading-none">{month}</span>}
                        </span>
                      );
                    }
                    return (
                      <button
                        key={cell.day}
                        type="button"
                        data-day={cell.day}
                        onClick={() => pick(cell.day)}
                        disabled={pausing}
                        aria-pressed={selected}
                        aria-label={short(cell.day)}
                        className={`press flex min-h-11 flex-col items-center justify-center rounded-xl border text-sm font-semibold tabular-nums ${
                          selected
                            ? "border-forest bg-forest text-ivory"
                            : "border-line text-forest hover:border-forest"
                        }`}
                      >
                        <span aria-hidden="true">{date}</span>
                        {month && (
                          <span aria-hidden="true" className="text-[0.65rem] font-normal leading-none">
                            {month}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div aria-live="polite" className="mt-3 grid min-h-6 gap-1 text-sm" data-pause-preview>
                {from && to && <p className="font-semibold text-forest">{range(from, to)}</p>}
                {preview?.endAfter && preview.endBefore && preview.endAfter !== preview.endBefore && (
                  <p className="text-graphite">
                    {p.endsInstead.replace("{end}", short(preview.endAfter)).replace("{was}", short(preview.endBefore))}
                  </p>
                )}
                {preview && preview.added > 0 && (
                  <p className="text-muted">
                    {p.moved.replace("{n}", String(preview.added)).replace("{days}", plural(preview.added, p.dayForms))}
                  </p>
                )}
                {error && <p className="font-semibold text-danger">{error}</p>}
              </div>

              <ConfirmButton disabled={!check?.ok} label={p.confirm} pendingLabel={p.saving} />
            </form>
          )}

          <div aria-live="polite" className="mt-3 min-h-6 text-sm" data-pause-result>
            {result.ok && (
              <p role="status" className="font-semibold text-forest">
                {result.ok}
              </p>
            )}
            {result.error && (
              <p role="alert" className="font-semibold text-danger">
                {result.error}
              </p>
            )}
          </div>

          <section className="mt-4 border-t border-line pt-4">
            <h3 className="label text-muted">{p.list}</h3>
            {list.length === 0 ? (
              <p className="mt-2 text-sm text-muted">{p.none}</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {list.map((pause) => {
                  const removable = customerCanRemove(pause, firstDay);
                  const note = pause.source === "staff" ? p.byStaff : removable ? null : p.locked;
                  return (
                    <li
                      key={pause.id ?? `${pause.from}-${pause.to}`}
                      className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border border-line bg-white px-4 py-2"
                      data-pause-row
                    >
                      <p className="text-sm tabular-nums text-graphite">
                        <span className="font-semibold text-forest">{range(pause.from, pause.to)}</span>
                        {note && <span className="text-muted"> · {note}</span>}
                      </p>
                      {removable && pause.id && (
                        <form action={removeAction}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="pause_id" value={pause.id} />
                          <RemoveButton label={p.remove} pendingLabel={p.removing} range={range(pause.from, pause.to)} />
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </dialog>
    </>
  );
}

function ConfirmButton({ disabled, label, pendingLabel }: { disabled: boolean; label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="btn btn-forest mt-3 min-h-12 w-full disabled:opacity-50 sm:w-auto"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function RemoveButton({ label, pendingLabel, range }: { label: string; pendingLabel: string; range: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={`${label}: ${range}`}
      className="btn btn-outline min-h-11 px-4 text-sm text-forest disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
