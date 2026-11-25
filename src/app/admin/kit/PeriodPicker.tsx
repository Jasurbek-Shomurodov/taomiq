import { Segmented } from "./Segmented";

/**
 * Picks the period of a report: quick choices as links (Segmented), and a custom from–to as a plain GET form, so it
 * works before the scripts load and the period lives in the address (bookmarkable, shareable). The page validates the
 * period again and falls back to its default; `min` / `max` only help the browser's own date picker. `hidden` carries
 * the page's other parameters (the open tab) through the form. A custom period has no preset highlighted.
 */
export function PeriodPicker({
  action,
  presets,
  value,
  from,
  to,
  min,
  max,
  hidden = {},
  labels,
}: {
  /** The page's path, where the form sends from and to. */
  action: string;
  presets: { key: string; label: string; href: string }[];
  /** The preset in use, or null for a custom from–to. */
  value: string | null;
  from: string;
  to: string;
  min: string;
  max: string;
  hidden?: Record<string, string>;
  labels: { group: string; presets: string; custom: string; from: string; to: string; show: string };
}) {
  return (
    <div role="group" aria-label={labels.group} className="adm-no-print flex flex-wrap items-center gap-x-4 gap-y-3">
      <Segmented label={labels.presets} items={presets} value={value ?? ""} className="max-w-full" />
      <form method="get" action={action} aria-label={labels.custom} className="flex flex-wrap items-center gap-2">
        {Object.entries(hidden).map(([name, val]) => (
          <input key={name} type="hidden" name={name} value={val} />
        ))}
        <label className="flex items-center gap-1.5">
          <span className="adm-caption font-medium">{labels.from}</span>
          <input
            // Remount on a new period, so the field shows it after a preset or Back in the browser.
            key={`from-${from}`}
            type="date"
            name="from"
            required
            defaultValue={from}
            min={min}
            max={max}
            className="adm-input min-h-[34px] w-[10.5rem] py-1 tabular-nums"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="adm-caption font-medium">{labels.to}</span>
          <input
            key={`to-${to}`}
            type="date"
            name="to"
            required
            defaultValue={to}
            min={min}
            max={max}
            className="adm-input min-h-[34px] w-[10.5rem] py-1 tabular-nums"
          />
        </label>
        <button type="submit" className="adm-btn adm-btn-outline adm-btn-sm">
          {labels.show}
        </button>
      </form>
    </div>
  );
}
