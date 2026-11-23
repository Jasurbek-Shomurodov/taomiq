/**
 * The approved TAOMIQ logo (source: src/assets/brand/taomiq-logo.jpg), redrawn with the site's fonts and
 * brand tokens so it stays sharp at any size and works on light and dark backgrounds.
 *
 * Geometry is measured from the source, in its own pixels, with the ring's centre as the origin, and was
 * checked side by side against it: ring stroke ≈ 1% of its diameter; TQ in the serif with a cap height of
 * ≈ 37% of the ring; the wordmark in the sans, bold and wide-set, IQ always gold; the tagline in small,
 * very wide-tracked gold capitals as wide as the wordmark. Raster forms (favicon, share image, alert card)
 * are crops of the source made by scripts/build-brand-assets.mjs.
 */

const RING_OUTER = 258;
const RING_STROKE = 5.5;
const MONOGRAM_BOX = RING_OUTER * 2;

const TQ = { size: 268, weight: 800, tracking: 4, baseline: 82 };
const WORDMARK = { size: 182, weight: 700, tracking: 28, baseline: 451 };
const TAGLINE = { size: 37, weight: 500, tracking: 17.4, baseline: 542 };

// Stacked lockup box: the tagline sets the width, the ring top and the tagline (or the Q's tail) the height.
const LOCKUP_HALF_WIDTH = 436;
const LOCKUP_BOTTOM = { tagline: 550, wordmark: 476 };

/** Keeps the hairline ring at least one device pixel wide however small the mark is drawn. */
function ringStroke(unitsPerPixel: number) {
  return Math.max(RING_STROKE, unitsPerPixel);
}

/**
 * Text drawn with letter-spacing carries the spacing after its last letter too; shift centred text by half
 * of it so the letters themselves are centred.
 */
const centred = (tracking: number) => tracking / 2;

function MonogramShapes({ onDark, strokeWidth }: { onDark: boolean; strokeWidth: number }) {
  return (
    <>
      <circle r={RING_OUTER - strokeWidth / 2} fill="none" className="stroke-gold" strokeWidth={strokeWidth} />
      <text
        x={centred(TQ.tracking)}
        y={TQ.baseline}
        textAnchor="middle"
        fontSize={TQ.size}
        fontWeight={TQ.weight}
        letterSpacing={TQ.tracking}
        className={`font-serif ${onDark ? "fill-ivory" : "fill-forest"}`}
      >
        TQ
      </text>
    </>
  );
}

/** TQ monogram in a thin gold ring. Decorative: the caller names the logo once. */
export function Monogram({
  size = 56,
  onDark = true,
  className = "",
}: {
  size?: number;
  onDark?: boolean;
  className?: string;
}) {
  const half = MONOGRAM_BOX / 2;
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`${-half} ${-half} ${MONOGRAM_BOX} ${MONOGRAM_BOX}`}
      className={`shrink-0 overflow-visible ${className}`}
    >
      <MonogramShapes onDark={onDark} strokeWidth={ringStroke(MONOGRAM_BOX / size)} />
    </svg>
  );
}

/** Wordmark: TAOM in ivory (dark background) or forest (light background), IQ always gold. */
export function Logo({ onDark = false, className = "" }: { onDark?: boolean; className?: string }) {
  return (
    <span role="img" aria-label="TAOMIQ" className={`inline-block whitespace-nowrap ${className}`}>
      <Wordmark onDark={onDark} />
    </span>
  );
}

function Wordmark({ onDark }: { onDark: boolean }) {
  return (
    <span
      aria-hidden
      // Tracking from the source (0.154 em); the negative margin cancels the spacing after the Q.
      className={`-mr-[0.154em] font-sans font-bold tracking-[0.154em] ${onDark ? "text-ivory" : "text-forest"}`}
    >
      TAOM<span className="text-gold">IQ</span>
    </span>
  );
}

/**
 * Monogram with the wordmark. `stacked` is the full logo as supplied (ring above the wordmark, optional
 * tagline); `inline` puts a small monogram before the wordmark for headers. One accessible name: TAOMIQ.
 */
export function Lockup({
  layout = "stacked",
  onDark = true,
  tagline = false,
  width = 200,
  markSize = 34,
  markClassName = "",
  className = "",
}: {
  layout?: "stacked" | "inline";
  onDark?: boolean;
  /** Stacked only: show PREMIUM DAILY NUTRITION under the wordmark. */
  tagline?: boolean;
  /** Stacked only: rendered width in pixels. */
  width?: number;
  /** Inline only: monogram size in pixels. The wordmark follows the font size set through className. */
  markSize?: number;
  markClassName?: string;
  className?: string;
}) {
  if (layout === "inline") {
    return (
      <span role="img" aria-label="TAOMIQ" className={`inline-flex items-center gap-[0.55em] whitespace-nowrap ${className}`}>
        <Monogram size={markSize} onDark={onDark} className={markClassName} />
        <Wordmark onDark={onDark} />
      </span>
    );
  }

  const boxWidth = LOCKUP_HALF_WIDTH * 2;
  const bottom = tagline ? LOCKUP_BOTTOM.tagline : LOCKUP_BOTTOM.wordmark;
  const boxHeight = RING_OUTER + bottom;
  return (
    <svg
      role="img"
      aria-label="TAOMIQ"
      width={width}
      height={Math.round((width * boxHeight) / boxWidth)}
      viewBox={`${-LOCKUP_HALF_WIDTH} ${-RING_OUTER} ${boxWidth} ${boxHeight}`}
      className={`shrink-0 overflow-visible ${className}`}
    >
      <MonogramShapes onDark={onDark} strokeWidth={ringStroke(boxWidth / width)} />
      <text
        x={centred(WORDMARK.tracking)}
        y={WORDMARK.baseline}
        textAnchor="middle"
        fontSize={WORDMARK.size}
        fontWeight={WORDMARK.weight}
        letterSpacing={WORDMARK.tracking}
        className={`font-sans ${onDark ? "fill-ivory" : "fill-forest"}`}
      >
        TAOM<tspan className="fill-gold">IQ</tspan>
      </text>
      {tagline && (
        <text
          x={centred(TAGLINE.tracking)}
          y={TAGLINE.baseline}
          textAnchor="middle"
          fontSize={TAGLINE.size}
          fontWeight={TAGLINE.weight}
          letterSpacing={TAGLINE.tracking}
          className="fill-gold font-sans"
        >
          PREMIUM DAILY NUTRITION
        </text>
      )}
    </svg>
  );
}
