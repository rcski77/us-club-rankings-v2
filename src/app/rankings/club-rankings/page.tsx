import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Fragment } from "react";
import { brand } from "@/lib/brand";
import { tableWrapClass, thClass, tdClass, numThClass, numTdClass, tbodyClass, RankBadge } from "@/lib/publicUi";
import { ordinalSuffix } from "@/lib/rating/powerRankings";
import { AGE_GROUPS } from "@/lib/ranking/clubRanking";
import type { ClubRankingSource } from "@/generated/prisma/enums";
import { SeasonFilterSelect } from "../team-rankings/SeasonFilterSelect";
import { DEFAULT_PAGE_SIZE, Pagination, parsePage } from "../Pagination";

const SOURCES = [
  { value: "NPS", label: "NPS" },
  { value: "COMBINED", label: "Combined" },
] as const;

export default async function PublicClubRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; source?: string; page?: string }>;
}) {
  const { season: seasonParam, source: sourceParam, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);

  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const season = seasons.find((s) => s.id === seasonParam) ?? activeSeason;
  const source: ClubRankingSource = sourceParam === "COMBINED" ? "COMBINED" : "NPS";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Club Rankings</h1>

      {seasons.length === 0 || !season ? (
        <p className="text-sm text-slate-500">No seasons available yet.</p>
      ) : (
        <>
          <div className="mb-6 flex items-end gap-3">
            <form method="get" className="flex items-end gap-3">
              <input type="hidden" name="source" value={source} />
              <label className="flex flex-col gap-1 text-sm">
                Season
                <SeasonFilterSelect seasons={seasons} defaultValue={season.id} />
              </label>
            </form>
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <Link
                key={s.value}
                href={`/rankings/club-rankings?${new URLSearchParams({ season: season.id, source: s.value })}`}
                className={
                  s.value === source
                    ? "rounded-full px-4 py-1.5 text-sm font-semibold text-white shadow-sm"
                    : "rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                }
                style={s.value === source ? { backgroundColor: brand.purple } : undefined}
              >
                {s.label}
              </Link>
            ))}
            <Link
              href="/rankings/club-rankings/five-year"
              className="rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              5-Year Aggregate
            </Link>
          </div>

          <ClubRankingTable seasonId={season.id} source={source} page={page} />
        </>
      )}
    </div>
  );
}

async function ClubRankingTable({
  seasonId,
  source,
  page,
}: {
  seasonId: string;
  source: ClubRankingSource;
  page: number;
}) {
  // rank is precomputed and stored (unlike the power/combined team-rankings views),
  // so this can page at the DB level -- qualified clubs are already ranked ahead of
  // under-qualified ones, so a page boundary landing between the two groups just
  // means one of the two group headers below doesn't render on that page.
  const totalCount = await prisma.clubRankingResult.count({ where: { seasonId, source } });
  const results = await prisma.clubRankingResult.findMany({
    where: { seasonId, source },
    include: {
      club: true,
      contributions: { include: { team: true }, orderBy: { ageGroup: "asc" } },
    },
    orderBy: { rank: "asc" },
    skip: (page - 1) * DEFAULT_PAGE_SIZE,
    take: DEFAULT_PAGE_SIZE,
  });

  const qualified = results.filter((r) => r.isQualified);
  const underQualified = results.filter((r) => !r.isQualified);

  const groups: { label: string; rows: typeof results }[] = [
    { label: "Qualified (3+ age groups in that age group's top 100)", rows: qualified },
    { label: "Under-qualified (still ranked, sorted after qualified clubs)", rows: underQualified },
  ];

  return (
    <>
    <div className={tableWrapClass}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ backgroundColor: brand.purple }}>
            <th className={numThClass}>Rank</th>
            <th className={thClass}>Club</th>
            <th className={numThClass}>Total Points</th>
            <th className={numThClass}>
              <span className="sm:hidden">Top-100</span>
              <span className="hidden sm:inline">Top-100 Age Groups</span>
            </th>
            {AGE_GROUPS.map((ag) => (
              <th key={ag} className={numThClass}>
                {ag}U
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={tbodyClass}>
          {groups.map(
            (group) =>
              group.rows.length > 0 && (
                <Fragment key={group.label}>
                  <tr>
                    <td colSpan={4 + AGE_GROUPS.length} className={`${tdClass} bg-slate-100 font-semibold text-slate-700`}>
                      {group.label}
                    </td>
                  </tr>
                  {group.rows.map((r) => {
                    const byAgeGroup = new Map(r.contributions.map((c) => [c.ageGroup, c]));
                    // Not persisted directly on ClubRankingResult (only isQualified
                    // is) -- derived here the same way the admin table does, from
                    // each age group's own rank against the top-100 threshold.
                    const qualifyingAgeGroupCount = r.contributions.filter(
                      (c) => c.rank !== null && c.rank <= 100,
                    ).length;
                    return (
                      <tr key={r.id} className="relative cursor-pointer">
                        <td className={numTdClass}>
                          <RankBadge rank={r.rank} />
                        </td>
                        <td className={`${tdClass} max-w-[180px] truncate font-medium text-slate-900`}>
                          <Link href={`/rankings/clubs/${r.club.id}`} className="after:absolute after:inset-0 hover:underline">
                            {r.club.name}
                          </Link>
                        </td>
                        <td className={`${numTdClass} font-semibold`} style={{ color: brand.purple }}>
                          {r.totalPoints.toFixed(1)}
                        </td>
                        <td className={numTdClass}>{qualifyingAgeGroupCount}</td>
                        {AGE_GROUPS.map((ag) => {
                          const c = byAgeGroup.get(ag);
                          if (!c || !c.team) {
                            return (
                              <td key={ag} className={`${numTdClass} text-slate-400`}>
                                —
                              </td>
                            );
                          }
                          return (
                            <td
                              key={ag}
                              className={`${numTdClass} relative z-10 ${c.countedInBest5 ? "" : "text-slate-400 line-through"}`}
                              title={c.team.name}
                            >
                              <Link href={`/rankings/teams/${c.team.id}`} className="hover:underline">
                                {c.rank}
                                {ordinalSuffix(c.rank ?? 0)}
                              </Link>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </Fragment>
              ),
          )}
          {results.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={4 + AGE_GROUPS.length}>
                No club rankings yet for this season.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    <Pagination
      page={page}
      totalCount={totalCount}
      pageSize={DEFAULT_PAGE_SIZE}
      basePath="/rankings/club-rankings"
      baseParams={new URLSearchParams({ season: seasonId, source })}
    />
    </>
  );
}
