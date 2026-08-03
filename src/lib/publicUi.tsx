// Shared table chrome for public-facing pages (rankings, team detail, etc.) --
// deliberately fancier than the plain admin tables (src/lib/ui.ts): rounded card,
// dark brand-purple header, zebra striping, and a colored badge for rank columns.
export const tableWrapClass = "overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm";
export const thClass =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/85 whitespace-nowrap";
export const tdClass = "px-4 py-3 text-sm text-slate-700 whitespace-nowrap";
// For the primary name/link column (team, club, tournament, ...) -- wraps and caps
// width on narrow screens so one long name can't force the whole table wider than the
// viewport, pushing every other column out past the horizontal scroll; reverts to the
// normal single-line behavior once there's room (sm+).
export const primaryTdClass =
  "max-w-[9.5rem] whitespace-normal break-words px-4 py-3 text-sm font-medium text-slate-900 sm:max-w-none sm:whitespace-nowrap";
// Same idea as primaryTdClass, for a secondary text column (e.g. a team's club name)
// that sits next to the primary column -- narrower cap since it's not the main thing
// being scanned.
export const secondaryTdClass =
  "max-w-[7rem] whitespace-normal break-words px-4 py-3 text-sm text-slate-500 sm:max-w-none sm:whitespace-nowrap";
// Narrower/centered variant for single-number columns (ranks, ratings, matches played,
// points) -- the roomy px-4 padding on tdClass/thClass is meant for name/text columns
// and otherwise pushes wide tables past the page.
export const numThClass =
  "px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider text-white/85 whitespace-nowrap";
export const numTdClass = "px-2 py-3 text-center text-sm text-slate-700 whitespace-nowrap";
export const tbodyClass =
  "divide-y divide-slate-100 [&>tr]:transition-colors [&>tr:nth-child(even)]:bg-slate-50/70 [&>tr:hover]:bg-teal-50/70";
// Same zebra/hover treatment as tbodyClass, for a plain list of <div> rows (e.g. match
// results) rather than a <table>'s <tr> children -- tbodyClass's [&>tr] selectors
// wouldn't match a div.
export const rowListClass =
  "divide-y divide-slate-100 [&>*]:transition-colors [&>*:nth-child(even)]:bg-slate-50/70 [&>*:hover]:bg-teal-50/70";

export function RankBadge({ rank }: { rank: number | string | undefined }) {
  const n = typeof rank === "number" ? rank : undefined;
  if (n === undefined) return <span className="text-slate-400">—</span>;
  const style =
    n === 1
      ? "bg-yellow-400 text-yellow-950"
      : n === 2
        ? "bg-slate-300 text-slate-800"
        : n === 3
          ? "bg-amber-700 text-white"
          : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${style}`}>
      {n}
    </span>
  );
}

// Thresholds are on the raw Elo scale (~1500 = average, per computeEloRatings.ts's
// starting rating) -- not percentile-based, so the color bands stay stable over time
// rather than shifting as the player pool's overall rating distribution drifts.
export function EloBadge({ rating }: { rating: number | undefined }) {
  if (rating === undefined) return <span className="text-slate-400">—</span>;
  const n = Math.round(rating);
  const style =
    n >= 1700
      ? "border border-green-600 text-green-700"
      : n >= 1500
        ? "border border-blue-600 text-blue-700"
        : "border border-yellow-600 text-yellow-700";
  return (
    <span
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-transparent px-2 text-xs font-bold ${style}`}
    >
      {n}
    </span>
  );
}
