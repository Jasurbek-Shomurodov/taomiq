import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Tone } from "./Badge";

/**
 * One headline figure: caption, the figure (or "—" when it is unknown, never a made-up 0), an icon chip, and an
 * optional line under it (a comparison, a badge). A link when `href` is set. `tone` colours the icon chip when the
 * figure needs attention.
 */
export function StatTile({
  label,
  value,
  icon: Icon,
  href,
  tone = "accent",
  footer,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  href?: string;
  tone?: Tone;
  footer?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="adm-caption font-medium">{label}</p>
        {Icon && (
          <span className={`adm-tone-${tone} grid size-8 shrink-0 place-items-center rounded-adm-control`}>
            <Icon aria-hidden="true" className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-1 whitespace-nowrap text-[28px] font-semibold leading-tight tabular-nums text-adm-text">
        {value ?? "—"}
      </p>
      {footer && <div className="adm-caption mt-2 flex flex-wrap items-center gap-2">{footer}</div>}
    </>
  );
  const className = "adm-panel block";
  return href ? (
    <Link href={href} className={`${className} transition-colors hover:border-adm-accent`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
