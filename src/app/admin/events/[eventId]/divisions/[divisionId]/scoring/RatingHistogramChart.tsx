import type { RatingHistogram } from "@/lib/rating/ratingHistogram";

const WIDTH = 480;
const HEIGHT = 140;
const BAR_GAP = 2;

/**
 * Server-rendered SVG bar chart -- no client JS, no charting dependency. Each bin
 * shows the full (season, ageGroup) population as a light bar with this division's
 * portion of that bin highlighted in front, so it's clear whether the division's
 * ratings sit in the bottom, middle, or top of the overall spread rather than just
 * showing the division's own (much narrower) range in isolation.
 */
export function RatingHistogramChart({ histogram }: { histogram: RatingHistogram }) {
  const maxCount = Math.max(...histogram.bins.map((b) => b.count), 1);
  const barWidth = WIDTH / histogram.bins.length;

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT + 20}`} className="w-full max-w-lg" role="img">
        {histogram.bins.map((bin, i) => {
          const barHeight = (bin.count / maxCount) * HEIGHT;
          const subsetHeight = (bin.subsetCount / maxCount) * HEIGHT;
          return (
            <g key={i}>
              <rect
                x={i * barWidth + BAR_GAP / 2}
                y={HEIGHT - barHeight}
                width={barWidth - BAR_GAP}
                height={barHeight}
                className="fill-slate-200"
              />
              {bin.subsetCount > 0 && (
                <rect
                  x={i * barWidth + BAR_GAP / 2}
                  y={HEIGHT - subsetHeight}
                  width={barWidth - BAR_GAP}
                  height={subsetHeight}
                  className="fill-sky-600"
                />
              )}
              {bin.count > 0 && (
                <text
                  x={i * barWidth + barWidth / 2}
                  y={HEIGHT - barHeight - 4}
                  textAnchor="middle"
                  className="fill-slate-600 text-[9px]"
                >
                  {bin.count}
                </text>
              )}
            </g>
          );
        })}
        <text x={0} y={HEIGHT + 15} textAnchor="start" className="fill-slate-500 text-[10px]">
          {histogram.min.toFixed(3)}
        </text>
        <text x={WIDTH} y={HEIGHT + 15} textAnchor="end" className="fill-slate-500 text-[10px]">
          {histogram.max.toFixed(3)}
        </text>
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 bg-slate-200" /> All rated teams (season, age group)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 bg-sky-600" /> This division
        </span>
      </div>
    </div>
  );
}
