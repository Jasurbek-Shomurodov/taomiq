import type { ReactNode } from "react";

/**
 * Phones' order steps: "Step 2 of 3" over one segment per step. A segment's gold fill grows from the left
 * (scaleX, 400 ms) when its step is reached and shrinks back on Back. The label and the bar are hidden from
 * assistive tech: the step heading that takes focus carries the same words ("Step 2 of 3: Delivery").
 * `children` sits at the end of the label row (the Back button) and stays reachable.
 */
export function StepProgress({
  current,
  total,
  label,
  children,
}: {
  current: number;
  total: number;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <p className="label text-muted tabular-nums" aria-hidden>
          {label}
        </p>
        {children}
      </div>
      <div
        aria-hidden
        className="mt-1 grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className="h-1 overflow-hidden rounded-full bg-ivory-deep">
            <span
              className="block h-full origin-left rounded-full bg-gold transition-[scale] duration-[var(--duration-slow)] ease-out-calm"
              style={{ scale: index <= current ? "1 1" : "0 1" }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}
