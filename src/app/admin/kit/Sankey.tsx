/*
 * A three-column flow chart (Sankey) drawn by hand in SVG, no chart library: sources on the left flow into one node in
 * the middle, which flows out to the targets on the right. Every band keeps its width end to end, and its width is its
 * amount, so both sides add up to the middle node. Colours are the admin tokens (CSS variables), so it reads in light
 * and dark themes. The same figures are in a visually hidden table for screen readers; the drawing itself is
 * aria-hidden. On a narrow screen the drawing keeps its minimum width and scrolls sideways inside its own box.
 */

export type SankeyTone = "accent" | "positive" | "info" | "caution" | "negative" | "neutral";

export type SankeyNode = {
  key: string;
  label: string;
  amount: number;
  tone: SankeyTone;
};

const TONE_VAR: Record<SankeyTone, string> = {
  accent: "var(--adm-accent)",
  positive: "var(--adm-positive)",
  info: "var(--adm-info)",
  caution: "var(--adm-caution)",
  negative: "var(--adm-negative)",
  neutral: "var(--adm-text-muted)",
};

// Geometry, in viewBox units (the SVG scales to its box; text stays legible down to the minimum width below).
const WIDTH = 820;
const BAR = 12;
const LEFT_BAR_X = 182;
const MID_BAR_X = (WIDTH - BAR) / 2;
const RIGHT_BAR_X = WIDTH - 236 - BAR;
const LABEL_GAP = 8;
/** The height the whole total takes. */
const FLOW_HEIGHT = 300;
/** Room for a node's two label lines, so small nodes never overlap. */
const MIN_SLOT = 36;
const GAP = 10;
const TOP = 44;
const BOTTOM = 12;

type Placed = SankeyNode & { y: number; h: number };

/** Each node's bar: height by amount, in a slot tall enough for its label, the column centred in `plot`. */
function place(nodes: readonly SankeyNode[], scale: number, plot: number): Placed[] {
  const slots = nodes.map((node) => Math.max(node.amount * scale, MIN_SLOT));
  const column = slots.reduce((sum, slot) => sum + slot, 0) + GAP * Math.max(nodes.length - 1, 0);
  let y = TOP + (plot - column) / 2;
  return nodes.map((node, i) => {
    const h = node.amount * scale;
    const placed = { ...node, y: y + (slots[i] - h) / 2, h };
    y += slots[i] + GAP;
    return placed;
  });
}

function columnHeight(nodes: readonly SankeyNode[], scale: number): number {
  return (
    nodes.reduce((sum, node) => sum + Math.max(node.amount * scale, MIN_SLOT), 0) + GAP * Math.max(nodes.length - 1, 0)
  );
}

/** A band of constant width h from (x0, y0) to (x1, y1), top edges given, curving halfway. */
function band(x0: number, y0: number, x1: number, y1: number, h: number): string {
  const mid = (x0 + x1) / 2;
  return [
    `M ${x0} ${y0}`,
    `C ${mid} ${y0}, ${mid} ${y1}, ${x1} ${y1}`,
    `L ${x1} ${y1 + h}`,
    `C ${mid} ${y1 + h}, ${mid} ${y0 + h}, ${x0} ${y0 + h}`,
    "Z",
  ].join(" ");
}

/** Each node with the top of its band on the middle node: stacked from `start` in column order. */
function stack(nodes: readonly Placed[], start: number): { node: Placed; at: number }[] {
  const out: { node: Placed; at: number }[] = [];
  let at = start;
  for (const node of nodes) {
    out.push({ node, at });
    at += node.h;
  }
  return out;
}

export function Sankey({
  sources,
  middle,
  targets,
  total,
  format,
  share,
  caption,
  headers,
  scrollHint,
}: {
  /** Left column, in order (top to bottom). */
  sources: SankeyNode[];
  /** The middle node's name. */
  middle: string;
  /** Right column, in order. */
  targets: SankeyNode[];
  /** Σ sources = Σ targets: the middle node. */
  total: number;
  /** An amount as text ("1 250 000 сум"). */
  format: (amount: number) => string;
  /** A share of the total (0..1) as text ("12 %"). */
  share: (fraction: number) => string;
  /** The hidden table's caption: what the chart shows. */
  caption: string;
  /** The hidden table's column names. */
  headers: { from: string; to: string; amount: string; share: string };
  /** Said under the drawing on narrow screens. */
  scrollHint: string;
}) {
  const scale = total > 0 ? FLOW_HEIGHT / total : 0;
  const plot = Math.max(FLOW_HEIGHT, columnHeight(sources, scale), columnHeight(targets, scale));
  const height = TOP + plot + BOTTOM;
  const left = place(sources, scale, plot);
  const right = place(targets, scale, plot);
  const midY = TOP + (plot - FLOW_HEIGHT) / 2;
  const midH = total * scale;

  // Where each band meets the middle node: stacked in column order on each side.
  const inBands = stack(left, midY);
  const outBands = stack(right, midY);

  const muted = { fill: "var(--adm-text-muted)" };
  const strong = { fill: "var(--adm-text)" };

  return (
    <figure className="m-0 grid gap-2">
      <div className="overflow-x-auto overscroll-x-contain">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="block h-auto w-full min-w-[720px]"
          aria-hidden="true"
          focusable="false"
        >
          {inBands.map(({ node, at }) => (
            <path
              key={`in-${node.key}`}
              d={band(LEFT_BAR_X + BAR, node.y, MID_BAR_X, at, node.h)}
              style={{ fill: TONE_VAR[node.tone], fillOpacity: 0.28 }}
            />
          ))}
          {outBands.map(({ node, at }) => (
            <path
              key={`out-${node.key}`}
              d={band(MID_BAR_X + BAR, at, RIGHT_BAR_X, node.y, node.h)}
              style={{ fill: TONE_VAR[node.tone], fillOpacity: 0.28 }}
            />
          ))}

          {left.map((node) => (
            <g key={`l-${node.key}`}>
              <rect x={LEFT_BAR_X} y={node.y} width={BAR} height={Math.max(node.h, 1)} rx={2} style={{ fill: TONE_VAR[node.tone] }} />
              <text x={LEFT_BAR_X - LABEL_GAP} y={node.y + node.h / 2 - 3} textAnchor="end" fontSize={13} fontWeight={600} style={strong}>
                {node.label}
              </text>
              <text x={LEFT_BAR_X - LABEL_GAP} y={node.y + node.h / 2 + 13} textAnchor="end" fontSize={12} style={muted}>
                {format(node.amount)}
              </text>
            </g>
          ))}

          <rect x={MID_BAR_X} y={midY} width={BAR} height={Math.max(midH, 1)} rx={2} style={{ fill: "var(--adm-text)" }} />
          <text x={WIDTH / 2} y={midY - 22} textAnchor="middle" fontSize={13} fontWeight={600} style={strong}>
            {middle}
          </text>
          <text x={WIDTH / 2} y={midY - 7} textAnchor="middle" fontSize={12} style={muted}>
            {format(total)}
          </text>

          {right.map((node) => (
            <g key={`r-${node.key}`}>
              <rect x={RIGHT_BAR_X} y={node.y} width={BAR} height={Math.max(node.h, 1)} rx={2} style={{ fill: TONE_VAR[node.tone] }} />
              <text x={RIGHT_BAR_X + BAR + LABEL_GAP} y={node.y + node.h / 2 - 3} fontSize={13} fontWeight={600} style={strong}>
                {node.label}
              </text>
              <text x={RIGHT_BAR_X + BAR + LABEL_GAP} y={node.y + node.h / 2 + 13} fontSize={12} style={muted}>
                {format(node.amount)} · {share(total > 0 ? node.amount / total : 0)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="adm-caption sm:hidden">{scrollHint}</p>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{headers.from}</th>
            <th scope="col">{headers.to}</th>
            <th scope="col">{headers.amount}</th>
            <th scope="col">{headers.share}</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((node) => (
            <tr key={`t-in-${node.key}`}>
              <td>{node.label}</td>
              <td>{middle}</td>
              <td>{format(node.amount)}</td>
              <td>{share(total > 0 ? node.amount / total : 0)}</td>
            </tr>
          ))}
          {targets.map((node) => (
            <tr key={`t-out-${node.key}`}>
              <td>{middle}</td>
              <td>{node.label}</td>
              <td>{format(node.amount)}</td>
              <td>{share(total > 0 ? node.amount / total : 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
