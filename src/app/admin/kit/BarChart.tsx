export type ChartBar = {
  key: string;
  value: number;
  /** The figure as shown: "5", "1 250 000 сум". */
  display: string;
  /** What the bar is, in full: "пн, 24 нояб.". Tooltip and the screen-reader table. */
  label: string;
  /** A short axis label under the bar; most bars have none. */
  axis?: string;
  /** The bar to look at first (today): solid, the rest are a 35 % tint. */
  current?: boolean;
};

/** Tooltips and axis labels near an edge hang inwards, so they never leave the panel. */
function align(index: number, count: number): string {
  if (index < 2) return "left-0";
  if (index > count - 3) return "right-0";
  return "left-1/2 -translate-x-1/2";
}

/**
 * A hand-built column chart (no chart library): one column per bar, scaled to the largest, a tooltip on hover or focus, and
 * the same figures as a visually hidden table for screen readers. Colours come from the --adm-* tokens, so the dark
 * theme only swaps variables. An empty bar is a short stub, so a quiet day still reads as a day.
 */
export function BarChart({
  bars,
  caption,
  headers,
  maxLabel,
}: {
  bars: ChartBar[];
  /** The table's caption: what the chart shows. */
  caption: string;
  /** Column names of the table: [what a bar is, its figure]. */
  headers: [string, string];
  /** A line over the chart naming the top of the scale. */
  maxLabel?: string;
}) {
  const max = Math.max(0, ...bars.map((bar) => bar.value));

  return (
    <figure className="m-0 grid gap-2">
      {maxLabel && (
        <p aria-hidden="true" className="adm-caption text-right tabular-nums">
          {maxLabel}
        </p>
      )}
      {/* Each column is a tab stop (and takes focus on a tap), so keyboard and touch users can read a day's figure;
          the tooltip shows on hover and on focus. Screen readers get the column's name once (the tooltip text is
          aria-hidden), and the table below for reading the series as a whole. */}
      <div role="group" aria-label={caption} className="flex h-40 items-end gap-[3px] border-b border-adm-border sm:h-48">
        {bars.map((bar, i) => {
          const height = bar.value > 0 && max > 0 ? `${Math.max((bar.value / max) * 100, 3)}%` : "3px";
          const fill =
            bar.value <= 0
              ? "bg-adm-surface-muted"
              : bar.current
                ? "bg-adm-accent"
                : "bg-adm-accent/35 group-hover:bg-adm-accent/60 group-focus:bg-adm-accent/60";
          return (
            <span
              key={bar.key}
              tabIndex={0}
              role="img"
              aria-label={`${bar.label}: ${bar.display}`}
              className="group flex h-full min-w-0 flex-1 items-end rounded-t-[3px] outline-offset-1"
            >
              <span className={`relative block w-full rounded-t-[3px] transition-colors ${fill}`} style={{ height }}>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute bottom-full z-10 mb-1.5 whitespace-nowrap rounded-md bg-adm-text px-2 py-1 text-xs font-medium tabular-nums text-adm-surface opacity-0 shadow-adm transition-opacity group-hover:opacity-100 group-focus:opacity-100 ${align(i, bars.length)}`}
                >
                  {bar.label}: {bar.display}
                </span>
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
