import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { brand } from "@/lib/brand";
import { tableWrapClass, thClass, tdClass, numThClass, numTdClass, tbodyClass, RankBadge } from "@/lib/publicUi";
import { FIVE_YEAR_WEIGHTS } from "@/lib/ranking/fiveYearClubRanking";
import { LEGACY_IMPORT_ALGORITHM_VERSION } from "@/lib/ranking/computeFiveYearClubRanking";

// Only the top 100 gets published (NIT invites/housing priority), same cap the
// legacy workbook's own published sheets used -- unlike /rankings/club-rankings
// (NPS/Combined), which shows every qualified/under-qualified club, this view is
// capped, and the admin equivalent (/admin/club-rankings/five-year) stays uncapped
// for staff QA.
const PUBLISHED_RANK_LIMIT = 100;

const SOURCES = [
  { value: "NPS", label: "NPS" },
  { value: "COMBINED", label: "Combined" },
] as const;

export default async function PublicFiveYearClubRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ endYear?: string }>;
}) {
  const { endYear: endYearParam } = await searchParams;

  const [availableYearRows, seasons] = await Promise.all([
    // Excludes legacy-imported windows (2021-2024, from the workbook's own "5 Year to
    // Publish" sheet -- see importLegacyFiveYearRankings.ts) -- those have no
    // per-year contributions to show in the breakdown table below, so this page (the
    // full single-window view) only ever offers windows this app itself computed.
    // The rank-history view (five-year/history) is where the legacy windows still
    // show up, since that one only ever needs rank+total per column, not a breakdown.
    prisma.clubFiveYearRankingResult.findMany({
      where: { algorithmVersion: { not: LEGACY_IMPORT_ALGORITHM_VERSION } },
      distinct: ["endYear"],
      select: { endYear: true },
      orderBy: { endYear: "desc" },
    }),
    // Just to link the NPS/Combined pills back with a real season id, same convention
    // as /rankings/club-rankings itself.
    prisma.season.findMany({ orderBy: { startDate: "desc" } }),
  ]);
  const availableYears = availableYearRows.map((y) => y.endYear);
  const defaultSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const endYear = Number(endYearParam) || availableYears[0];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Club Rankings</h1>

      {availableYears.length === 0 || !endYear ? (
        <p className="text-sm text-slate-500">No 5-year rankings available yet.</p>
      ) : (
        <>
          {availableYears.length > 1 && (
            <div className="mb-6 flex items-end gap-3">
              <div className="flex flex-col gap-1 text-sm">
                Window
                <div className="flex flex-wrap gap-2">
                  {availableYears.map((y) => (
                    <Link
                      key={y}
                      href={`/rankings/club-rankings/five-year?${new URLSearchParams({ endYear: String(y) })}`}
                      className={
                        y === endYear
                          ? "rounded-full px-4 py-1.5 text-sm font-semibold text-white shadow-sm"
                          : "rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                      }
                      style={y === endYear ? { backgroundColor: brand.teal } : undefined}
                    >
                      {y - 4}–{y}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mb-6 flex flex-wrap gap-2">
            {defaultSeason &&
              SOURCES.map((s) => (
                <Link
                  key={s.value}
                  href={`/rankings/club-rankings?${new URLSearchParams({ season: defaultSeason.id, source: s.value })}`}
                  className="rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  {s.label}
                </Link>
              ))}
            <span
              className="rounded-full px-4 py-1.5 text-sm font-semibold text-white shadow-sm"
              style={{ backgroundColor: brand.purple }}
            >
              5-Year Aggregate
            </span>
          </div>

          <p className="mb-4 text-sm text-slate-500">
            Recency-weighted blend of each year&apos;s club-level score (
            {FIVE_YEAR_WEIGHTS.map((w) => `${w * 100}%`).join(" / ")}, oldest to newest) — used for NIT invites
            and housing priority. Top {PUBLISHED_RANK_LIMIT} shown.
          </p>

          <p className="mb-6 text-sm">
            <Link href="/rankings/club-rankings/five-year/history" className="underline" style={{ color: brand.purple }}>
              View rank history across every computed window →
            </Link>
          </p>

          <FiveYearClubRankingTable endYear={endYear} />
        </>
      )}
    </div>
  );
}

async function FiveYearClubRankingTable({ endYear }: { endYear: number }) {
  const results = await prisma.clubFiveYearRankingResult.findMany({
    where: { endYear, rank: { lte: PUBLISHED_RANK_LIMIT } },
    include: { club: true, contributions: { orderBy: { year: "asc" } } },
    orderBy: { rank: "asc" },
  });
  const computedAt = results[0]?.computedAt;
  const years = Array.from({ length: FIVE_YEAR_WEIGHTS.length }, (_, i) => endYear - (FIVE_YEAR_WEIGHTS.length - 1 - i));

  return (
    <>
      {computedAt && (
        <p className="mb-4 text-sm text-slate-500">
          Computed{" "}
          {computedAt.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}
        </p>
      )}

      <div className={tableWrapClass}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: brand.purple }}>
              <th className={numThClass}>Rank</th>
              <th className={thClass}>Club</th>
              <th className={thClass}>State</th>
              <th className={numThClass}>5-Year Total</th>
              {years.map((y, i) => (
                <th key={y} className={numThClass}>
                  {y} ({FIVE_YEAR_WEIGHTS[i] * 100}%)
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={tbodyClass}>
            {results.map((r) => {
              const byYear = new Map(r.contributions.map((c) => [c.year, c]));
              return (
                <tr key={r.id} className="cursor-pointer">
                  <td className={numTdClass}>
                    <RankBadge rank={r.rank} />
                  </td>
                  <td className={`${tdClass} relative max-w-[180px] truncate font-medium text-slate-900`}>
                    <Link href={`/rankings/clubs/${r.club.id}`} className="after:absolute after:inset-0 hover:underline">
                      {r.club.name}
                    </Link>
                  </td>
                  <td className={tdClass}>{r.club.state ?? "—"}</td>
                  <td className={`${numTdClass} font-semibold`} style={{ color: brand.purple }}>
                    {r.totalPoints.toFixed(2)}
                  </td>
                  {years.map((y) => {
                    const c = byYear.get(y);
                    if (!c || !c.present) {
                      return (
                        <td key={y} className={`${numTdClass} text-slate-400`}>
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={y} className={numTdClass}>
                        {c.points.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {results.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={4 + years.length}>
                  No 5-year ranking available for {endYear - 4}–{endYear}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
