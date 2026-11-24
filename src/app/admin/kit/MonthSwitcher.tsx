"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type MonthOption = {
  /** "YYYY-MM". */
  key: string;
  /** The month as shown: "Ноябрь 2026 г.". */
  label: string;
  /** The page's address for that month (the caller keeps its other parameters in it). */
  href: string;
};

/**
 * Moves a page between calendar months: previous month, a list of every month there is, next month. Modelled on
 * DaySwitcher; the month lives in the address (`?m=YYYY-MM`, built by the caller into each option's `href`), so a
 * month can be bookmarked, shared and reloaded, and the page validates it again. A list rather than a month field:
 * desktop Safari and Firefox have no month picker. An arrow at the edge of the range is drawn disabled.
 */
export function MonthSwitcher({
  value,
  months,
  prev,
  next,
  labels,
}: {
  value: string;
  /** Every month that can be chosen, newest first. */
  months: MonthOption[];
  /** Address of the month before and after, or null at the edge. */
  prev: string | null;
  next: string | null;
  labels: { group: string; select: string; prev: string; next: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div role="group" aria-label={labels.group} aria-busy={pending || undefined} className="adm-no-print flex items-center gap-1.5">
      <Arrow href={prev} label={labels.prev}>
        <ChevronLeft aria-hidden="true" />
      </Arrow>
      <select
        // Remount on a new month so the list shows it after an arrow or Back in the browser.
        key={value}
        defaultValue={value}
        aria-label={labels.select}
        className="adm-input min-h-[34px] w-auto min-w-[11rem] py-1 tabular-nums"
        onChange={(event) => {
          const target = months.find((month) => month.key === event.currentTarget.value);
          if (target && target.key !== value) startTransition(() => router.push(target.href, { scroll: false }));
        }}
      >
        {months.map((month) => (
          <option key={month.key} value={month.key}>
            {month.label}
          </option>
        ))}
      </select>
      <Arrow href={next} label={labels.next}>
        <ChevronRight aria-hidden="true" />
      </Arrow>
    </div>
  );
}

function Arrow({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const className = "adm-btn adm-btn-outline adm-btn-sm adm-btn-icon";
  return href ? (
    <Link href={href} aria-label={label} title={label} className={className} scroll={false}>
      {children}
    </Link>
  ) : (
    <span role="link" aria-disabled="true" aria-label={label} title={label} className={className}>
      {children}
    </span>
  );
}
