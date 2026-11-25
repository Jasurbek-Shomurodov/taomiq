/**
 * A hand-built heat map (no chart library): rows × columns of squares, each tinted by its value against the largest,
 * with a tooltip on hover (title) and the same figures as a visually hidden table for screen readers. Built for the
 * weekday × hour grid of the reports (7 × 24). Colours mix the --adm-accent token into the muted surface, so the dark
 * theme only swaps variables. An empty cell keeps the muted surface, so a quiet hour still reads as an hour.
 */
export function Heatmap({
  rows,
  columns,
  values,
  caption,
  corner,
  cellLabel,
  legend,
}: {
  /** Row names as shown at the start of each row ("Пн") and in full for the table ("Понедельник"). */
  rows: { short: string; long: string }[];
  /** Column names for the table ("09:00–10:00"); `axis` is the short label under the grid, on some columns only. */
  columns: { label: string; axis?: string }[];
  /** values[row][column], 0 or more. */
  values: number[][];
  /** The table's caption: what the grid shows. */
  caption: string;
  /** The table's corner header: what a row is ("День недели"). */
  corner: string;
  /** The tooltip of a cell: "Пн, 09:00–10:00: 3 заказа". */
  cellLabel: (row: number, column: number, value: number) => string;
  legend: { less: string; more: string };
}) {
  const max = Math.max(0, ...values.flat());
  const fill = (value: number) =>
    value <= 0 || max <= 0
      ? "var(--adm-surface-muted)"
      : `color-mix(in srgb, var(--adm-accent) ${Math.round(18 + (82 * value) / max)}%, var(--adm-surface-muted))`;
  const template = { gridTemplateColumns: `2.75rem repeat(${columns.length}, minmax(0, 1fr))` };

  return (
    <figure className="m-0 grid gap-2">
      <div aria-hidden="true" className="grid gap-[3px]" style={template}>
        {rows.map((row, r) => (
          <div key={row.long} className="contents">
            <span className="adm-caption flex items-center pr-1 font-medium">{row.short}</span>
            {columns.map((column, c) => {
              const value = values[r]?.[c] ?? 0;
              return (
                <span
                  key={column.label}
                  title={cellLabel(r, c, value)}
                  className="aspect-square min-w-0 rounded-[3px]"
                  style={{ background: fill(value) }}
                />
              );
            })}
          </div>
        ))}
        <span />
        {columns.map((column) => (
          <span key={column.label} className="relative h-4 min-w-0">
            {column.axis && (
              <span className="absolute top-0 left-0 whitespace-nowrap text-xs tabular-nums text-adm-muted">{column.axis}</span>
            )}
          </span>
        ))}
      </div>
      <p aria-hidden="true" className="adm-caption flex items-center justify-end gap-2">
        {legend.less}
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <span
            key={step}
            className="inline-block size-3 rounded-[3px]"
            style={{
              background:
                step === 0
                  ? "var(--adm-surface-muted)"
                  : `color-mix(in srgb, var(--adm-accent) ${Math.round(18 + 82 * step)}%, var(--adm-surface-muted))`,
            }}
          />
        ))}
        {legend.more}
      </p>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{corner}</th>
            {columns.map((column) => (
              <th key={column.label} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.long}>
              <th scope="row">{row.long}</th>
              {columns.map((column, c) => (
                <td key={column.label}>{values[r]?.[c] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
