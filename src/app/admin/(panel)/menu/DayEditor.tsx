"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { copyMenuFromVariant, saveMenuDay, type FormState, type MenuRow } from "@/lib/admin/actions";
import { CYCLE_DAYS, SLOTS, type Slot } from "@/lib/data/types";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";

type DishOption = { id: string; name: string; weight: number; kcal: number; protein: number; fat: number; carbs: number };
type Row = { dish_id: string; weight: string };

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
  const [copySource, setCopySource] = useState(otherVariants[0]?.id ?? "");

  const [rows, setRows] = useState<Record<Slot, Row>>(() =>
    Object.fromEntries(
      SLOTS.map((slot) => {
        const existing = saved.find((s) => s.slot === slot);
        return [slot, { dish_id: existing?.dish_id ?? "", weight: existing ? String(existing.weight_g) : "" }];
      }),
    ) as Record<Slot, Row>,
  );

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
    startTransition(async () => {
      const payload: MenuRow[] = SLOTS.map((slot) => ({
        slot,
        dish_id: rows[slot].dish_id,
        weight_g: Number(rows[slot].weight),
      }));
      const outcome = await saveMenuDay(variantId, day, payload);
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  }

  const copySourceLabel = otherVariants.find((v) => v.id === copySource)?.label;

  function copy(scope: "day" | "all") {
    if (!copySourceLabel) return;
    startTransition(async () => {
      const outcome = await copyMenuFromVariant(variantId, copySource, scope === "day" ? day : null);
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl text-forest">
          {variantLabel} · {m.day(day)}
        </h2>
        <p className="text-sm text-muted">{m.filled(filled, mealsPerDay)}</p>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
        {SLOTS.map((slot) => {
          const row = rows[slot];
          const n = nutrition(row);
          return (
            <div key={slot} className="grid gap-3 border-b border-line p-4 last:border-0 md:grid-cols-[7rem_1fr_7rem_14rem] md:items-center">
              <span className="label text-muted">{m.slots[slot]}</span>
              <select
                aria-label={m.dishAria(m.slots[slot])}
                value={row.dish_id}
                onChange={(e) => pickDish(slot, e.target.value)}
                className="field"
              >
                <option value="">{m.notSelected}</option>
                {dishes.map((dish) => (
                  <option key={dish.id} value={dish.id}>
                    {dish.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  aria-label={m.weightAria(m.slots[slot])}
                  type="number" min="1" step="5" inputMode="numeric"
                  value={row.weight}
                  disabled={!row.dish_id}
                  onChange={(e) => {
                    setRows({ ...rows, [slot]: { ...row, weight: e.target.value } });
                    setResult({});
                  }}
                  className="field tabular-nums disabled:bg-ivory"
                />
                {t.common.g}
              </label>
              <span className="text-sm tabular-nums text-graphite">
                {row.dish_id ? (
                  <>
                    <b>
                      {n.kcal} {t.common.kcal}
                    </b>
                    <span className="text-muted">
                      {" "}
                      · {t.common.p} {n.protein} · {t.common.f} {n.fat} · {t.common.c} {n.carbs}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Day total against the calorie target */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-forest p-5 text-ivory">
        <div className="tabular-nums">
          <p className="label text-gold">{m.total}</p>
          <p className="mt-1 font-serif text-3xl">
            {total.kcal}{" "}
            <span className="text-lg text-ivory/70">
              / {targetKcal} {t.common.kcal}
            </span>
          </p>
          <p className="text-sm text-ivory/70">
            {t.common.p} {total.protein} · {t.common.f} {total.fat} · {t.common.c} {total.carbs}
          </p>
        </div>
        <p className={`rounded-full px-4 py-1.5 text-sm font-semibold tabular-nums ${withinTarget ? "bg-sage text-forest" : "bg-ivory text-danger"}`}>
          {filled === 0
            ? m.dayEmpty
            : withinTarget
              ? m.withinTarget
              : m.offTarget(`${deviation > 0 ? "+" : ""}${deviation}`)}
        </p>
        <button type="button" onClick={save} disabled={pending} className="btn btn-gold disabled:opacity-60">
          {pending ? t.common.saving : m.saveDay}
        </button>
      </div>

      {result.ok && <p role="status" className="mt-3 rounded-lg bg-sage/40 p-3 text-sm text-forest">{result.ok}</p>}
      {result.error && <p role="alert" className="mt-3 rounded-lg bg-danger/10 p-3 text-sm text-danger">{result.error}</p>}

      {otherVariants.length > 0 && (
        <div className="mt-8 rounded-2xl border border-line bg-white p-5">
          <h3 className="font-semibold text-forest">{m.copyTitle}</h3>
          <p className="mt-1 text-sm text-muted">{m.copyText}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              aria-label={m.copyFrom}
              value={copySource}
              onChange={(e) => setCopySource(e.target.value)}
              className="field w-auto"
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
                triggerClassName="btn btn-outline !py-2 text-forest"
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
      )}
    </section>
  );
}
