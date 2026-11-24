import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A switch between views of the same data, as links (the view lives in the URL, so the server renders it). The
 * current one carries aria-current. For a client-side switch use buttons with aria-pressed inside .adm-segmented.
 */
export function Segmented({
  label,
  items,
  value,
  className = "",
}: {
  /** Accessible name of the group. */
  label: string;
  items: { key: string; label: ReactNode; href: string }[];
  value: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={`adm-segmented ${className}`}>
      {items.map((item) => (
        <Link key={item.key} href={item.href} aria-current={item.key === value ? "true" : undefined} scroll={false}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
