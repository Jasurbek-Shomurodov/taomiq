import type { ReactNode } from "react";

export type Tone = "positive" | "negative" | "caution" | "info" | "accent" | "neutral";

/**
 * A small pill. `status` adds the dot (.adm-status) for a state of a record (order, dish); the plain badge is for
 * a label. Colour carries meaning and the word is always there.
 */
export function Badge({
  tone = "neutral",
  status = false,
  icon,
  className = "",
  children,
}: {
  tone?: Tone;
  status?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`${status ? "adm-status" : "adm-badge"} adm-tone-${tone} ${className}`}>
      {icon}
      {children}
    </span>
  );
}
