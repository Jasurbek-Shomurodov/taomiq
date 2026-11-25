"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { Panel } from "../../kit/Panel";

/** One cell of the sheet, every figure already written out by the server. */
export type SheetCell = {
  /** The quantity alone, for the cell: "12,5". */
  short: string;
  quantity: string;
  amount: string;
  receipts: string;
  buyers: string;
  cost: string | null;
  usual: string | null;
  diff: string | null;
  tone: "caution" | "positive" | "neutral";
};

export type SheetRow = {
  key: string;
  name: string;
  unit: string;
  total: string;
  totalAmount: string;
  cells: Record<string, SheetCell>;
};

export type SheetDay = { day: string; label: string; short: string; isToday: boolean };

const TONE_TEXT = { caution: "text-adm-caution", positive: "text-adm-positive", neutral: "text-adm-muted" } as const;

/**
 * The ingredients × days grid: the first column (the ingredient) stays in place while the days scroll sideways. A
 * cell with a purchase is a button; the chosen one is described in the panel above the grid.
 */
export function PurchaseSheet({ rows, days, locale }: { rows: SheetRow[]; days: SheetDay[]; locale: Locale }) {
  const ts = getAdminDictionary(locale).purchases.sheet;
  const [selected, setSelected] = useState<{ row: string; day: string } | null>(null);
  const row = selected ? rows.find((r) => r.key === selected.row) : undefined;
  const cell = row && selected ? row.cells[selected.day] : undefined;
  const day = selected ? days.find((d) => d.day === selected.day) : undefined;

  return (
    <>
      <Panel as="div" aria-live="polite" className="min-h-[5.5rem]">
        {row && cell && day ? (
          <div className="flex items-start gap-3">
            <div className="grid min-w-0 flex-1 gap-1">
              <p className="font-semibold text-adm-text">{ts.detailTitle(row.name, day.label)}</p>
              <p className="text-sm tabular-nums text-adm-text">
                <b className="font-semibold">{cell.quantity}</b> · {cell.amount} · {cell.receipts}
              </p>
              <p className="adm-caption flex flex-wrap gap-x-2 tabular-nums">
                {cell.cost && <span className="font-medium text-adm-text">{cell.cost}</span>}
                {cell.usual && <span>{cell.usual}</span>}
                {cell.diff && <span className={`font-medium ${TONE_TEXT[cell.tone]}`}>{cell.diff}</span>}
              </p>
              <p className="adm-caption">{cell.buyers}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label={ts.close}
              className="adm-btn adm-btn-ghost adm-btn-sm adm-btn-icon"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ) : (
          <p className="adm-caption">{ts.detailEmpty}</p>
        )}
      </Panel>

      <Panel flush className="overflow-x-auto">
        <table className="w-max min-w-full border-separate border-spacing-0 text-left text-sm">
          <caption className="sr-only">{ts.caption}</caption>
          <thead className="adm-table-head">
            <tr>
              <th scope="col" className="sticky left-0 z-[1] min-w-40 bg-adm-surface-muted px-3 py-2 font-medium">
                {ts.ingredient}
              </th>
              {days.map((d) => (
                <th
                  key={d.day}
                  scope="col"
                  title={d.label}
                  className={`min-w-11 px-1 py-2 text-center font-medium tabular-nums ${d.isToday ? "text-adm-accent-ink" : ""}`}
                >
                  <span aria-hidden="true">{d.short}</span>
                  <span className="sr-only">{d.label}</span>
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {ts.total}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-[1] max-w-56 border-t border-adm-border bg-adm-surface px-3 py-2 font-medium text-adm-text"
                >
                  <span className="block truncate">{r.name}</span>
                  <span className="adm-caption font-normal">{r.unit}</span>
                </th>
                {days.map((d) => {
                  const c = r.cells[d.day];
                  const isSelected = selected?.row === r.key && selected.day === d.day;
                  return (
                    <td key={d.day} className="border-t border-l border-adm-border p-0 text-center">
                      {c ? (
                        <button
                          type="button"
                          onClick={() => setSelected(isSelected ? null : { row: r.key, day: d.day })}
                          aria-pressed={isSelected}
                          aria-label={ts.cellAria(r.name, d.label, `${c.quantity}, ${c.amount}`)}
                          className={`block min-h-10 w-full px-1 py-2 text-[13px] font-semibold tabular-nums transition-colors ${
                            isSelected ? "bg-adm-accent text-adm-surface" : "bg-adm-accent-tint text-adm-text hover:bg-adm-accent/25"
                          }`}
                        >
                          {c.short}
                        </button>
                      ) : null}
                    </td>
                  );
                })}
                <td className="whitespace-nowrap border-t border-l border-adm-border px-3 py-2 text-right tabular-nums">
                  <span className="block font-semibold text-adm-text">{r.totalAmount}</span>
                  <span className="adm-caption">{r.total}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
