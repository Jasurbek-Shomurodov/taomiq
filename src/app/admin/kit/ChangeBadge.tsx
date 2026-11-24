import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { htmlLang, type Locale } from "@/i18n/config";
import { Badge } from "./Badge";

/** A share or a change as a percentage in the panel's language: 0.34 → "34 %", with `signed` 0.12 → "+12 %". */
export function formatPercent(fraction: number, locale: Locale, signed = false): string {
  return new Intl.NumberFormat(htmlLang[locale], {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(fraction);
}

/**
 * A change against an earlier figure (whole percent from stats.percentChange): green up, red down, grey for none.
 * Renders nothing when there is nothing to compare with (null), never a made-up 0 %. `goodWhen="down"` is for a
 * figure where less is better (spending): a rise is red and a fall green; the arrow still shows the direction.
 */
export function ChangeBadge({
  change,
  locale,
  goodWhen = "up",
}: {
  change: number | null;
  locale: Locale;
  goodWhen?: "up" | "down";
}) {
  if (change === null) return null;
  const better = goodWhen === "up" ? change > 0 : change < 0;
  const tone = change === 0 ? "neutral" : better ? "positive" : "negative";
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  return (
    <Badge tone={tone} icon={<Icon aria-hidden="true" />} className="tabular-nums">
      {formatPercent(change / 100, locale, true)}
    </Badge>
  );
}
