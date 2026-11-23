/**
 * Wordmark per Brandbook section 02: TAOM in cream (dark bg) or forest (light bg), IQ always gold.
 * Text-based until the approved vector logo is supplied.
 */
export function Logo({ onDark = false, className = "" }: { onDark?: boolean; className?: string }) {
  return (
    <span
      className={`font-sans font-bold tracking-[0.04em] ${onDark ? "text-ivory" : "text-forest"} ${className}`}
      aria-label="TAOMIQ"
    >
      TAOM<span className="text-gold">IQ</span>
    </span>
  );
}

/** TQ monogram in a thin gold ring (Brandbook section 03). */
export function Monogram({ size = 56 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-full border border-gold font-serif text-ivory"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      TQ
    </span>
  );
}
