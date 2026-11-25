"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Moves a day sheet between dates: previous day, a date field, next day. The day lives in the address
 * (`<basePath>?date=YYYY-MM-DD`), so a sheet can be bookmarked, shared and reloaded; the page validates it again and
 * falls back to its default day. An arrow at the edge of the allowed range is drawn disabled.
 */
export function DaySwitcher({
  basePath,
  day,
  min,
  max,
  prev,
  next,
  labels,
  extraQuery = "",
}: {
  basePath: string;
  /** More of the address kept on every move, e.g. "&days=3". */
  extraQuery?: string;
  day: string;
  min: string;
  max: string;
  prev: string | null;
  next: string | null;
  labels: { group: string; date: string; prev: string; next: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = (value: string) => `${basePath}?date=${value}${extraQuery}`;

  // A desktop date field reports a complete date after every typed segment ("3" of "30" is already the 3rd), so the
  // sheet moves only once typing has paused, or at once on Enter or when the field is left. A phone's picker reports
  // once, and the pause covers it.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const go = (value: string, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // A half-typed year is a valid date too (0202-…): only a full date inside the range moves the sheet.
    if (!ISO_DAY.test(value) || value < min || value > max || value === day) return;
    const move = () => startTransition(() => router.push(href(value)));
    if (delay === 0) move();
    else timer.current = setTimeout(move, delay);
  };

  return (
    <div role="group" aria-label={labels.group} aria-busy={pending || undefined} className="adm-no-print flex items-center gap-1.5">
      <Arrow href={prev ? href(prev) : null} label={labels.prev}>
        <ChevronLeft aria-hidden="true" />
      </Arrow>
      <input
        type="date"
        // Remount on a new day so the field shows it after an arrow or Back in the browser.
        key={day}
        defaultValue={day}
        min={min}
        max={max}
        aria-label={labels.date}
        className="adm-input min-h-[34px] w-[10.5rem] py-1 tabular-nums"
        onChange={(event) => go(event.currentTarget.value, 900)}
        onBlur={(event) => go(event.currentTarget.value, 0)}
        onKeyDown={(event) => {
          if (event.key === "Enter") go(event.currentTarget.value, 0);
        }}
      />
      <Arrow href={next ? href(next) : null} label={labels.next}>
        <ChevronRight aria-hidden="true" />
      </Arrow>
    </div>
  );
}

function Arrow({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const className = "adm-btn adm-btn-outline adm-btn-sm adm-btn-icon";
  return href ? (
    <Link href={href} aria-label={label} title={label} className={className}>
      {children}
    </Link>
  ) : (
    <span role="link" aria-disabled="true" aria-label={label} title={label} className={className}>
      {children}
    </span>
  );
}
