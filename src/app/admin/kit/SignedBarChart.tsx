import type { ChartBar } from "./BarChart";

/** Tooltips and axis labels near an edge hang inwards, so they never leave the panel. */
function align(index: number, count: number): string {
  if (index < 2) return "left-0";
  if (index > count - 3) return "right-0";
  return "left-1/2 -translate-x-1/2";
}

/**
 * A column chart for figures that can fall below zero (a result, a profit): columns above the zero line are green,
 * below it red, each scaled to the largest distance from zero on its side, so the line sits where the two meet. Built
 * like BarChart (no chart library): a tooltip on hover or focus, a stub for an exact zero, and the same figures as a
 * visually hidden table for screen readers. `current` marks the bar to look at first (solid; the rest a tint).
 */
export function SignedBarChart({
  bars,
  caption,
  headers,
}: {
  bars: ChartBar[];
  /** The table's caption: what the chart shows. */
  caption: string;
  /** Column names of the table: [what a bar is, its figure]. */
  headers: [string, string];
}) {
  const up = Math.max(0, ...bars.map((bar) => bar.value));
  const down = Math.max(0, ...bars.map((bar) => -bar.value));
  const range = up + down;
  // The share of the height above the zero line; all at or above zero puts the line at the bottom.
  const above = range > 0 ? up / range : 1;

  return (
    <figure className="m-0 grid gap-2">
      <div role="group" aria-label={caption} className="flex h-44 gap-[3px] sm:h-52">
        {bars.map((bar, i) => {
          const positive = bar.value > 0;
          const negative = bar.value < 0;
          const size = range > 0 ? `${Math.max((Math.abs(bar.value) / range) * 100, 2)}%` : "0";
          const tint = bar.current ? "" : "opacity-60 group-hover:opacity-100 group-focus:opacity-100";
          return (
            <span
              key={bar.key}
              tabIndex={0}
              role="img"
              aria-label={`${bar.label}: ${bar.display}`}
              className="group relative flex h-full min-w-0 flex-1 flex-col outline-offset-1"
            >
              {/* Above the line (its share of the height): the bar grows up from it. */}
              <span className="flex min-h-0 flex-col justify-end" style={{ flex: `${above} 1 0` }}>
                {positive && (
                  <span
                    className={`block w-full rounded-t-[3px] bg-adm-positive transition-opacity ${tint}`}
                    style={{ height: `min(100%, calc(${size} / ${above}))` }}
                  />
                )}
                {!positive && !negative && <span className="block h-[3px] w-full rounded-[2px] bg-adm-surface-muted" />}
              </span>
              <span aria-hidden="true" className="block h-px w-full bg-adm-border" />
              {/* Below the line: the bar hangs down from it. */}
              <span className="flex min-h-0 flex-col" style={{ flex: `${1 - above} 1 0` }}>
                {negative && (
                  <span
                    className={`block w-full rounded-b-[3px] bg-adm-negative transition-opacity ${tint}`}
                    style={{ height: `min(100%, calc(${size} / ${1 - above}))` }}
                  />
                )}
              </span>
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-md bg-adm-text px-2 py-1 text-xs font-medium tabular-nums text-adm-surface opacity-0 shadow-adm transition-opacity group-hover:opacity-100 group-focus:opacity-100 ${align(i, bars.length)}`}
              >
                {bar.label}: {bar.display}
              </span>
            </span>
          );
        })}
      </div>
      <div aria-hidden="true" className="flex h-4 gap-[3px]">
        {bars.map((bar, i) => (
          <span key={bar.key} className="relative min-w-0 flex-1">
            {bar.axis && (
              <span
                className={`absolute top-0 whitespace-nowrap text-xs tabular-nums ${
                  bar.current ? "font-semibold text-adm-accent-ink" : "text-adm-muted"
                } ${align(i, bars.length)}`}
              >
                {bar.axis}
              </span>
            )}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{headers[0]}</th>
            <th scope="col">{headers[1]}</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.key}>
              <th scope="row">{bar.label}</th>
              <td>{bar.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
