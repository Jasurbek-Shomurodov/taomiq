import { useEffect, useRef, useState } from "react";

/**
 * Counts the shown number from its previous value to `target` over `duration` ms (ease-out, one
 * requestAnimationFrame loop). A null target keeps the last value. With prefers-reduced-motion the
 * new value is shown on the next frame. matchMedia is read in the effect, never during render.
 *
 * The returned number is for display only: announce the final value separately (aria-live).
 */
export function useCountUp(target: number | null, duration = 700, from = 0): number {
  const [value, setValue] = useState(from);
  // Last value on screen: where the next count starts, also when a count is cut short.
  const shown = useRef(from);

  useEffect(() => {
    if (target === null) return;
    const start = shown.current;
    if (start === target) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = reduce ? 0 : duration;
    let frame = 0;
    let startedAt: number | null = null;

    const tick = (now: number) => {
      startedAt ??= now;
      const progress = total === 0 ? 1 : Math.min((now - startedAt) / total, 1);
      const eased = 1 - (1 - progress) ** 3;
      const next = progress === 1 ? target : Math.round(start + (target - start) * eased);
      shown.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}
