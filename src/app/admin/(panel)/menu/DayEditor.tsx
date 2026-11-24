"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { copyMenuFromVariant, saveMenuDay, type FormState, type MenuRow } from "@/lib/admin/actions";
import { CYCLE_DAYS, SLOTS, type Slot } from "@/lib/data/types";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { Badge } from "../../kit/Badge";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { TopBarActions } from "../../shell/TopBarSlot";
import { useReportDirty } from "./MenuWorkspace";

type DishOption = { id: string; name: string; weight: number; kcal: number; protein: number; fat: number; carbs: number };
type Row = { dish_id: string; weight: string };
type Rows = Record<Slot, Row>;

/** The day form's id: the top bar's Save submits it with form=. */
const FORM_ID = "menu-day-form";

function rowsFrom(saved: MenuRow[]): Rows {
  return Object.fromEntries(
    SLOTS.map((slot) => {
      const existing = saved.find((s) => s.slot === slot);
      return [slot, { dish_id: existing?.dish_id ?? "", weight: existing ? String(existing.weight_g) : "" }];
    }),
  ) as Rows;
}

/** Whether saving `rows` would change the saved day (weights are stored rounded to whole grams). */
function differs(rows: Rows, saved: Rows) {
  return SLOTS.some((slot) => {
    const a = rows[slot];
    const b = saved[slot];
    if (a.dish_id !== b.dish_id) return true;
    return a.dish_id !== "" && Math.round(Number(a.weight)) !== Math.round(Number(b.weight));
  });
}

// ---------- One day of one calorie level ----------

/** One day of one calorie level. Keyed by level and day, so it starts from the saved day on every switch. */
export function DayEditor({
  variantId,
  variantLabel,
  targetKcal,
  mealsPerDay,
  day,
  locale,
  dishes,
  saved,
  otherVariants,
}: {
  variantId: string;
  variantLabel: string;
  targetKcal: number;
  mealsPerDay: number;
  day: number;
  locale: Locale;
  dishes: DishOption[];
  saved: MenuRow[];
  otherVariants: { id: string; label: string }[];
}) {
  const router = useRouter();
  const t = getAdminDictionary(locale);
  const m = t.menu;
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<FormState>({});
  const [copyResult, setCopyResult] = useState<FormState>({});
  const [copySource, setCopySource] = useState(otherVariants[0]?.id ?? "");
  const copySourceId = useId();

  // The form starts from the saved day. When the saved rows change on the server (after a save, or a copy into
  // this day) it takes them, unless the person changed something since that save or copy started: then their edits
  // stay, still marked unsaved.
  const savedRows = rowsFrom(saved);
  const savedKey = JSON.stringify(savedRows);
  const [base, setBase] = useState<{ key: string; rows: Rows }>({ key: savedKey, rows: savedRows });
  const [rows, setRows] = useState<Rows>(savedRows);
  /** The rows as they were when the last save or copy started; null when none is in flight. */
  const [sent, setSent] = useState<Rows | null>(null);
  if (savedKey !== base.key) {
    const untouched = !differs(rows, base.rows) || (sent !== null && !differs(rows, sent));
    setBase({ key: savedKey, rows: savedRows });
    setSent(null);
    if (untouched) setRows(savedRows);
  }
  const dirty = differs(rows, savedRows);
  // Rows that are being saved right now are not "unsaved": no leave question for them.
  const beingSaved = pending && sent !== null && !differs(rows, sent);
  useReportDirty(dirty && !beingSaved);

  // One write at a time: a second Enter before the first save returns does nothing.
  const busy = useRef(false);

  const dishById = new Map(dishes.map((d) => [d.id, d]));

  const nutrition = (row: Row) => {
    const dish = dishById.get(row.dish_id);
    const k = Number(row.weight) / 100;
    if (!dish || !Number.isFinite(k)) return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    return {
      kcal: Math.round(dish.kcal * k),
      protein: Math.round(dish.protein * k),
      fat: Math.round(dish.fat * k),
      carbs: Math.round(dish.carbs * k),
    };
  };

  const total = SLOTS.reduce(
    (sum, slot) => {
      const n = nutrition(rows[slot]);
      return { kcal: sum.kcal + n.kcal, protein: sum.protein + n.protein, fat: sum.fat + n.fat, carbs: sum.carbs + n.carbs };
    },
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
  const filled = SLOTS.filter((slot) => rows[slot].dish_id).length;
  const deviation = total.kcal - targetKcal;
  const withinTarget = Math.abs(deviation) <= targetKcal * 0.05;

  function pickDish(slot: Slot, dishId: string) {
    const dish = dishById.get(dishId);
    setRows({ ...rows, [slot]: { dish_id: dishId, weight: dish ? String(dish.weight) : "" } });
    setResult({});
  }

  function save() {
    if (busy.current) return;
    busy.current = true;
    setSent(rows);
    startTransition(async () => {
      try {
        const payload: MenuRow[] = SLOTS.map((slot) => ({
          slot,
          dish_id: rows[slot].dish_id,
          weight_g: Number(rows[slot].weight),
        }));
        const outcome = await saveMenuDay(variantId, day, payload);
        setResult(outcome);
        if (outcome.ok) router.refresh();
        else setSent(null);
      } finally {
        busy.current = false;
      }
    });
  }

  const copySourceLabel = otherVariants.find((v) => v.id === copySource)?.label;

  function copy(scope: "day" | "all") {
    if (!copySourceLabel || busy.current) return;
    busy.current = true;
    setSent(rows);
    setResult({});
    startTransition(async () => {
      try {
        const outcome = await copyMenuFromVariant(variantId, copySource, scope === "day" ? day : null);
        setCopyResult(outcome);
        if (outcome.ok) router.refresh();
        else setSent(null);
      } finally {
        busy.current = false;
      }
    });
  }

  // Save sits in the top bar, so bring its outcome into view.
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result.ok || result.error) resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [result]);

  const saveButton = (
    <button
      type="submit"
      form={FORM_ID}
      disabled={pending}
      aria-busy={pending || undefined}
      className="adm-btn adm-btn-primary"
    >
      {pending ? t.common.saving : m.saveDay}
    </button>
  );

  return (
    <>
      {/* Save in the top bar submits the day form by its id (form=), so Enter in a weight field saves too. */}
      <TopBarActions>{saveButton}</TopBarActions>

      <div ref={resultRef} className="empty:hidden">
        {result.ok && <Notice tone="positive">{result.ok}</Notice>}
        {result.error && <Notice tone="negative">{result.error}</Notice>}
      </div>

      <form
        id={FORM_ID}
        // The day is saved from state, not from form fields. The server checks the weights (as before), so the
        // browser's own checks (step, min) stay off.
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="grid gap-5"
      >
        {/* Before the scripts run, a press of Save reloads this same day instead of dropping the selection. */}
        <input type="hidden" name="variant" value={variantId} />
        <input type="hidden" name="day" value={day} />

        <Panel
          flush
          title={`${variantLabel} · ${m.day(day)}`}
          actions={
            <>
              {dirty && !beingSaved && <Badge tone="caution">{m.unsaved}</Badge>}
              <Badge tone={filled >= mealsPerDay ? "positive" : "neutral"} className="tabular-nums">
                {m.filled(filled, mealsPerDay)}
              </Badge>
            </>
          }
        >
          <div>
            {SLOTS.map((slot) => {
              const row = rows[slot];
              const n = nutrition(row);
              return (
                <div key={slot} className="adm-row flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
                  <div className="min-w-0 basis-full sm:basis-44 sm:shrink-0">
                    <p className="text-sm font-semibold text-adm-text">{m.slots[slot]}</p>
                    <p className="adm-caption mt-0.5 tabular-nums">
                      {row.dish_id ? (
                        <>
                          <b className="font-semibold text-adm-text">
                            {n.kcal} {t.common.kcal}
                          </b>{" "}
                          · {t.common.p} {n.protein} · {t.common.f} {n.fat} · {t.common.c} {n.carbs}
                        </>
                      ) : (
                        "—"
                      )}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-3 sm:basis-0">
                    <select
                      aria-label={m.dishAria(m.slots[slot])}
                      value={row.dish_id}
                      onChange={(e) => pickDish(slot, e.target.value)}
                      className="adm-input min-w-0 flex-[1_1_14rem]"
                    >
                      <option value="">{m.notSelected}</option>
                      {dishes.map((dish) => (
                        <option key={dish.id} value={dish.id}>
                          {dish.name}
                        </option>
                      ))}
                    </select>
                    <label className="flex w-32 shrink-0 items-center gap-2 text-sm text-adm-muted">
                      <input
                        aria-label={m.weightAria(m.slots[slot])}
                        type="number" min="1" step="5" inputMode="numeric"
                        value={row.weight}
                        disabled={!row.dish_id}
                        onChange={(e) => {
                          setRows({ ...rows, [slot]: { ...row, weight: e.target.value } });
                          setResult({});
                        }}
                        className="adm-input tabular-nums"
                      />
                      {t.common.g}
                    </label>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Day total against the calorie target */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-adm-border bg-adm-page px-4 py-4 sm:px-5">
            <div className="tabular-nums">
              <p className="adm-caption font-medium">{m.total}</p>
              <p className="mt-1 text-[28px] font-semibold leading-tight text-adm-text">
                {total.kcal}{" "}
                <span className="text-base font-medium text-adm-muted">
                  / {targetKcal} {t.common.kcal}
                </span>
              </p>
              <p className="text-sm text-adm-muted">
                {t.common.p} {total.protein} · {t.common.f} {total.fat} · {t.common.c} {total.carbs}
              </p>
            </div>
            <Badge
              status
              tone={filled === 0 ? "neutral" : withinTarget ? "positive" : "caution"}
              className="tabular-nums"
            >
              {filled === 0
                ? m.dayEmpty
                : withinTarget
                  ? m.withinTarget
                  : m.offTarget(`${deviation > 0 ? "+" : ""}${deviation}`)}
            </Badge>
          </div>
        </Panel>

        <BeforeHydration>
          {/* Until the scripts run, the top bar has no Save: the form keeps its own. */}
          <div>{saveButton}</div>
        </BeforeHydration>
      </form>

      {otherVariants.length > 0 && (
        <Panel flush title={m.copyTitle} description={m.copyText}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
            <label htmlFor={copySourceId} className="basis-full text-sm font-semibold text-adm-text sm:basis-44 sm:shrink-0">
              {m.copyFrom}
            </label>
            <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-3 sm:basis-0">
              <select
                id={copySourceId}
                value={copySource}
                onChange={(e) => setCopySource(e.target.value)}
                className="adm-input min-w-0 flex-[1_1_12rem] sm:max-w-64"
              >
                {otherVariants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              {(
                [
                  ["day", m.onlyDay(day), m.copyWhatDay(day)],
                  ["all", m.allDays(CYCLE_DAYS), m.copyWhatAll(CYCLE_DAYS)],
                ] as const
              ).map(([scope, label, what]) => (
                <ConfirmDialog
                  key={scope}
                  trigger={label}
                  triggerClassName="adm-btn adm-btn-outline"
                  disabled={pending || !copySourceLabel}
                  title={m.copyAskTitle(what, copySourceLabel ?? "", variantLabel)}
                  description={m.copyAskText}
                  confirmLabel={m.copyButton}
                  pendingLabel={t.common.saving}
                  cancelLabel={t.common.cancel}
                  pending={pending}
                  onConfirm={() => copy(scope)}
                />
              ))}
            </div>
          </div>
          {(copyResult.ok || copyResult.error) && (
            <div className="px-4 pb-4 sm:px-5">
              {copyResult.ok && <Notice tone="positive">{copyResult.ok}</Notice>}
              {copyResult.error && <Notice tone="negative">{copyResult.error}</Notice>}
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
