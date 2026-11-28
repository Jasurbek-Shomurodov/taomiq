/**
 * The approved TAOMIQ logo (source: src/assets/brand/taomiq-logo.jpg), redrawn with the site's fonts and
 * brand tokens so it stays sharp at any size and works on light and dark backgrounds.
 *
 * Geometry is measured from the source, in its own pixels, with the ring's centre as the origin, and was
 * checked side by side against it: ring stroke ≈ 1% of its diameter; TQ in the serif (as outlines) with a cap height
 * of ≈ 37% of the ring; the wordmark in the sans, bold and wide-set, IQ always gold; the tagline in small,
 * very wide-tracked gold capitals as wide as the wordmark. Raster forms (favicon, share image, alert card)
 * are crops of the source made by scripts/build-brand-assets.mjs.
 */

const RING_OUTER = 258;
const RING_STROKE = 5.5;
const MONOGRAM_BOX = RING_OUTER * 2;

/**
 * TQ, drawn as outlines: Noto Serif Display at weight 800, 268 units, 4 units of tracking, baseline 82, centred as
 * the text was (the outlines of that text, taken from the font with Core Text and checked against it pixel for pixel).
 * A path needs no font, so the site no longer loads the serif's weight 800 for two letters.
 */
const TQ_PATH =
  "M-156.6 82L-156.6 79.3L-146.8 79.3Q-142.2 79.3 -138.7 78.1Q-135.3 76.9 -133.4 73.2Q-131.5 69.6 -131.5 62L-131.5 -106.7L-148.7 -106.7Q-163.4 -106.7 -172.5 -103Q-181.7 -99.3 -186.1 -90.8Q-190.6 -82.2 -191.7 -67.7L-192.5 -55.3L-195.2 -55.3L-193.3 -109.4L-21 -109.4L-19.1 -55.3L-21.8 -55.3L-22.7 -67.7Q-23.8 -82.2 -28.3 -90.8Q-32.7 -99.3 -41.8 -103Q-50.8 -106.7 -65.6 -106.7L-82.6 -106.7L-82.6 62.6Q-82.6 69.8 -80.6 73.4Q-78.7 77.1 -75.2 78.2Q-71.6 79.3 -67.3 79.3L-57.5 79.3L-57.5 82ZM137.6 146.3Q125.1 146.3 113 142.8Q100.9 139.2 90.9 131.5Q80.9 123.8 74.5 111.8Q68.1 99.8 66.6 82.9Q42.8 78.4 27.1 65.4Q11.3 52.3 3.5 32Q-4.3 11.6 -4.3 -14.2Q-4.3 -44 6 -65.9Q16.4 -87.9 37.2 -100.1Q58 -112.3 89.4 -112.3Q119.2 -112.3 140 -100.1Q160.7 -87.9 171.5 -65.8Q182.2 -43.7 182.2 -13.9Q182.2 22.7 165.6 48Q148.9 73.2 117.6 81.3Q118.3 100.3 121.4 112.5Q124.6 124.6 129.7 131.4Q134.9 138.2 141.4 140.9Q148 143.6 155.7 143.6L160 143.6L160 146.3ZM89.2 82Q100.5 82 108.5 76.7Q116.5 71.5 121.5 60.1Q126.4 48.7 128.7 30.4Q131 12 131 -13.9Q131 -39.9 128.7 -58.1Q126.4 -76.3 121.4 -87.7Q116.4 -99.1 108.5 -104.3Q100.6 -109.6 89.4 -109.6Q77.9 -109.6 69.8 -104.3Q61.7 -99.1 56.6 -87.7Q51.5 -76.3 49.2 -58.1Q46.9 -39.9 46.9 -13.9Q46.9 12 49.2 30.4Q51.5 48.7 56.6 60.1Q61.6 71.5 69.7 76.7Q77.7 82 89.2 82Z";
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
      <path d={TQ_PATH} className={onDark ? "fill-ivory" : "fill-forest"} />
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
