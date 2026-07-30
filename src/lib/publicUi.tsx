// Shared table chrome for public-facing pages (rankings, team detail, etc.) --
// deliberately fancier than the plain admin tables (src/lib/ui.ts): rounded card,
// dark brand-purple header, zebra striping, and a colored badge for rank columns.
export const tableWrapClass = "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm";
export const thClass =
  "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/85 whitespace-nowrap";
export const tdClass = "px-4 py-3 text-sm text-slate-700 whitespace-nowrap";
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
