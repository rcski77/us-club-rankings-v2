export type RankHistoryPoint = { label: string; rank: number };
export type RankHistorySeries = {
  name: string;
  points: RankHistoryPoint[];
  colorClassName?: string;
  dotClassName?: string;
};

const WIDTH = 480;
const HEIGHT = 160;
const PAD_LEFT = 32;
const PAD_RIGHT = 16;
const PAD_BOTTOM = 24;
const PAD_TOP = 20;

/**
 * Server-rendered SVG line chart -- same "no client JS, no charting dependency"
 * pattern as RatingHistogramChart. Rank is inverted (lower rank = better = higher on
 * the chart) with the y-axis scaled to the combined min/max across every series
 * rather than a fixed 1..N range, since a club's rank can span anywhere from single
 * digits to the thousands depending on age group depth. Supports multiple series
 * (e.g. 1-year vs. 5-year) sharing one x-axis -- the axis is the union of every
 * series' labels, sorted, so a series missing a given year just skips that x
 * position instead of forcing every series onto the same label set.
 */
export function RankHistoryChart({ series }: { series: RankHistorySeries[] }) {
  const nonEmpty = series.filter((s) => s.points.length > 0);
  if (nonEmpty.length === 0) {
    return <p className="text-sm text-slate-400">No data yet.</p>;
  }

  const labels = Array.from(new Set(nonEmpty.flatMap((s) => s.points.map((p) => p.label)))).sort();
  const ranks = nonEmpty.flatMap((s) => s.points.map((p) => p.rank));
  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const x = (label: string) => {
    const i = labels.indexOf(label);
    return labels.length === 1 ? PAD_LEFT + plotWidth / 2 : PAD_LEFT + (i / (labels.length - 1)) * plotWidth;
  };
  // Inverted: best (lowest) rank plots near the top. All-equal data gets pinned to
  // the vertical center rather than dividing by zero.
  const y = (rank: number) =>
    maxRank === minRank
      ? PAD_TOP + plotHeight / 2
      : PAD_TOP + ((rank - minRank) / (maxRank - minRank)) * plotHeight;

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full max-w-lg" role="img">
        <text x={0} y={PAD_TOP + 4} textAnchor="start" className="fill-slate-500 text-[10px]">
          #{minRank}
        </text>
        <text x={0} y={PAD_TOP + plotHeight} textAnchor="start" className="fill-slate-500 text-[10px]">
          #{maxRank}
        </text>
        {labels.map((label, i) => (
          <text
            key={label}
            x={x(label)}
            y={HEIGHT - 4}
            textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
            className="fill-slate-500 text-[9px]"
          >
            {label}
          </text>
        ))}
        {nonEmpty.map((s, si) => {
          const colorClassName = s.colorClassName ?? "stroke-sky-600";
          const dotClassName = s.dotClassName ?? "fill-sky-600";
          const pathD = s.points
            .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.label).toFixed(1)},${y(p.rank).toFixed(1)}`)
            .join(" ");
          // Alternate value labels above/below the line per series so two series
          // sharing an x position don't stack their numbers on top of each other.
          const labelDy = si % 2 === 0 ? -6 : 12;
          return (
            <g key={s.name}>
              <path d={pathD} fill="none" strokeWidth={1.5} className={colorClassName} />
              {s.points.map((p) => (
                <g key={p.label}>
                  <circle cx={x(p.label)} cy={y(p.rank)} r={2.5} className={dotClassName} />
                  <text
                    x={x(p.label)}
                    y={y(p.rank) + labelDy}
                    textAnchor="middle"
                    className={`text-[8px] ${dotClassName}`}
                  >
                    {p.rank}
                  </text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-slate-500">
        {nonEmpty.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1">
            {/* An SVG circle (not a div+bg-*) so this reuses the same fill-* class as
                the chart's own dots -- deriving a bg-* class from it via string
                replace looks equivalent but Tailwind's compiler only generates CSS
                for class names it finds literally in source, so a computed "bg-
                emerald-600" never actually gets generated. */}
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
              <circle cx={5} cy={5} r={5} className={s.dotClassName ?? "fill-sky-600"} />
            </svg>
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}
