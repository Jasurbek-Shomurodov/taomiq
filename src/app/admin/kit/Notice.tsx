import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "./Badge";

const ICONS = { positive: CircleCheck, negative: TriangleAlert, caution: TriangleAlert, info: Info } as const;

/**
 * An inline message: a failed load, a saved change. A failure says what failed and offers `retry` (a link that loads
 * the page again), and the figures it could not load print "—", never 0.
 */
export function Notice({
  tone = "info",
  retry,
  className = "",
  children,
}: {
  tone?: Extract<Tone, "positive" | "negative" | "caution" | "info">;
  retry?: { href: string; label: string };
  className?: string;
  children: ReactNode;
}) {
  const Icon = ICONS[tone];
  return (
    <div role={tone === "negative" ? "alert" : "status"} className={`adm-notice adm-tone-${tone} ${className}`}>
      <Icon aria-hidden="true" />
      <span className="min-w-0 flex-1">{children}</span>
      {retry && (
        // A plain link: a full load of the same address re-runs every read on the page.
        <a href={retry.href} className="adm-btn adm-btn-outline adm-btn-sm">
          {retry.label}
        </a>
      )}
    </div>
  );
}
