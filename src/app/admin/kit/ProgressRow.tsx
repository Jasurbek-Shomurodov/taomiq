import type { ReactNode } from "react";
import type { Tone } from "./Badge";

/** Solid fills for bars, from the kit tokens (the tinted .adm-tone-* backgrounds are too faint for a bar). */
export const TONE_FILL: Record<Tone, string> = {
  positive: "bg-adm-positive",
  negative: "bg-adm-negative",
  caution: "bg-adm-caution",
  info: "bg-adm-info",
  accent: "bg-adm-accent",
  neutral: "bg-adm-muted",
};

/**
 * One line of a breakdown: a name and its figure, a bar for its share (0..1), and an optional caption line under it.
 * The bar is decoration; the share is always written out in `value` or `detail` too.
 */
export function ProgressRow({
  label,
  value,
  share,
  detail,
  tone = "accent",
}: {
  label: ReactNode;
  value: ReactNode;
  share: number;
  detail?: ReactNode;
  tone?: Tone;
}) {
  const width = Math.min(Math.max(share, 0), 1) * 100;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-adm-text">{label}</span>
        <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-adm-text">{value}</span>
      </div>
      <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-adm-surface-muted">
        <span className={`block h-full rounded-full ${TONE_FILL[tone]}`} style={{ width: `${width}%` }} />
      </span>
      {detail && <div className="adm-caption flex flex-wrap justify-between gap-x-3 tabular-nums">{detail}</div>}
    </div>
  );
}
