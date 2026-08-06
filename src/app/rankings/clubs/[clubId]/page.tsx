import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { brand } from "@/lib/brand";
import {
  tableWrapClass,
  thClass,
  tdClass,
  primaryTdClass,
  numThClass,
  numTdClass,
  tbodyClass,
  RankBadge,
  EloBadge,
} from "@/lib/publicUi";
import { getLatestPowerRatings, computeCombinedRankByTeam } from "@/lib/rating/powerRankings";
import { rankFiveYearClubs } from "@/lib/ranking/fiveYearClubRanking";

export default async function PublicClubDetailPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    include: {
      region: true,
      teams: {
        include: { seasons: { include: { season: true }, orderBy: { season: { startDate: "desc" } } } },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!club) notFound();

  const [activeSeason, seasonRankings, fiveYearRankings, annualScores] = await Promise.all([
    prisma.season.findFirst({ where: { isActive: true } }),
    // Last 5 seasons' worth of the club's 1-year (season) aggregate rank -- COMBINED
    // source, same as the blended view /rankings/club-rankings defaults readers
    // toward via its own tab order.
    prisma.clubRankingResult.findMany({
      where: { clubId, source: "COMBINED" },
      include: { season: true },
      orderBy: { season: { startDate: "desc" } },
      take: 5,
    }),
    prisma.clubFiveYearRankingResult.findMany({
      where: { clubId },
      orderBy: { endYear: "desc" },
      take: 5,
    }),
    // Legacy-imported per-year totals (see importLegacyClubRankings.ts) -- the same
    // raw per-year figures the 5-year aggregate is built from double as the "1-Year"
    // ranking for years this app has no Season/ClubRankingResult of its own for.
    prisma.clubAnnualScore.findMany({
      where: { clubId },
      orderBy: { year: "desc" },
      take: 5,
    }),
  ]);

  // Both ranking rows are keyed by the calendar year a window/season ends in, so they
  // line up under shared column headers -- a season's own "year" is its endDate's
  // year, matching the convention ClubFiveYearRankingResult.endYear already uses.
  const seasonRankByYear = new Map(seasonRankings.map((r) => [r.season.endDate.getFullYear(), r]));
  const fiveYearRankByYear = new Map(fiveYearRankings.map((r) => [r.endYear, r]));
  const annualScoreByYear = new Map(annualScores.map((r) => [r.year, r]));
  const rankingYears = [
    ...new Set([...seasonRankByYear.keys(), ...fiveYearRankByYear.keys(), ...annualScoreByYear.keys()]),
  ]
    .sort((a, b) => b - a)
    .slice(0, 5);

  // The source workbook only recorded legacyRank for some years -- every year still
  // has a raw totalPoints (it's what the 5-year aggregate's own per-year breakdown is
  // built from), so derive a rank the same way rankFiveYearClubs already does for the
  // 5-year total, just scoped to one year's totalPoints across every club instead.
  const yearsNeedingDerivedRank = rankingYears.filter(
    (y) => !seasonRankByYear.has(y) && annualScoreByYear.get(y)?.legacyRank == null && annualScoreByYear.has(y),
  );
  const derivedRankByYear = new Map<number, number>();
  if (yearsNeedingDerivedRank.length > 0) {
    const allScoresForYears = await prisma.clubAnnualScore.findMany({
      where: { year: { in: yearsNeedingDerivedRank } },
    });
    for (const y of yearsNeedingDerivedRank) {
      const ranked = rankFiveYearClubs(
        allScoresForYears.filter((s) => s.year === y).map((s) => ({ clubId: s.clubId, totalPoints: s.totalPoints })),
      );
      const mine = ranked.find((r) => r.clubId === clubId);
      if (mine) derivedRankByYear.set(y, mine.rank);
    }
  }

  const sortedTeams = [...club.teams].sort((a, b) => {
    const aTs = activeSeason ? a.seasons.find((ts) => ts.seasonId === activeSeason.id) : undefined;
    const bTs = activeSeason ? b.seasons.find((ts) => ts.seasonId === activeSeason.id) : undefined;
    if (!aTs && !bTs) return a.name.localeCompare(b.name);
    if (!aTs) return 1;
    if (!bTs) return -1;
    if (aTs.ageGroup !== bTs.ageGroup) return aTs.ageGroup - bTs.ageGroup;
    return aTs.teamNumber.localeCompare(bTs.teamNumber, undefined, { numeric: true });
  });

  // Elo and Combined Rank are only meaningful scoped to one (season, ageGroup) --
  // fetch each once per distinct age group this club fields active-season teams in,
  // rather than once per team, since a club typically spans several age groups.
  const activeAgeGroups = activeSeason
    ? [
        ...new Set(
          sortedTeams
            .map((t) => t.seasons.find((ts) => ts.seasonId === activeSeason.id)?.ageGroup)
            .filter((a): a is number => a !== undefined),
        ),
      ]
    : [];

  const eloByTeamId = new Map<string, number>();
  const combinedRankByTeamId = new Map<string, number>();
  if (activeSeason) {
    const perAgeGroup = await Promise.all(
      activeAgeGroups.map((ageGroup) =>
        Promise.all([
          getLatestPowerRatings(activeSeason.id, ageGroup),
          computeCombinedRankByTeam(activeSeason.id, ageGroup),
        ]),
      ),
    );
    for (const [powerData, combinedRanks] of perAgeGroup) {
      for (const r of powerData.eloRatings) eloByTeamId.set(r.teamId, r.rating);
      for (const [teamId, rank] of combinedRanks) combinedRankByTeamId.set(teamId, rank);
    }
  }

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/rankings/clubs" className="underline">
          Clubs
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-semibold">{club.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {[club.region?.code, [club.city, club.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
      </p>

      <h2 className="mb-2 text-lg font-medium">Club Rankings</h2>
      <p className="mb-2 text-xs text-slate-500">
        Combined ranking; 5-Year is the recency-weighted aggregate ending that year. Most recent year first.
      </p>
      <div className={tableWrapClass}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: brand.purple }}>
              <th className={thClass}></th>
              {rankingYears.map((y) => (
                <th key={y} className={numThClass}>
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={tbodyClass}>
            <tr>
              <td className={`${tdClass} font-medium text-slate-900`}>1-Year</td>
              {rankingYears.map((y) => {
                const r = seasonRankByYear.get(y);
                if (r) {
                  return (
                    <td key={y} className={numTdClass}>
                      <Link
                        href={`/rankings/club-rankings?${new URLSearchParams({ season: r.seasonId, source: "COMBINED" })}`}
                        className="hover:underline"
                      >
                        <RankBadge rank={r.rank} />
                      </Link>
                    </td>
                  );
                }
                // No Season/ClubRankingResult of this app's own for that year --
                // fall back to the legacy-imported per-year total (the same raw
                // figure the 5-year aggregate itself uses for that year), using the
                // workbook's own rank where recorded, else one derived from totalPoints.
                const legacy = annualScoreByYear.get(y);
                const rank = legacy?.legacyRank ?? derivedRankByYear.get(y);
                if (!legacy || rank === undefined) {
                  return (
                    <td key={y} className={`${numTdClass} text-slate-400`}>
                      —
                    </td>
                  );
                }
                return (
                  <td key={y} className={numTdClass} title="Imported from the legacy ranking workbook">
                    <RankBadge rank={rank} />
                  </td>
                );
              })}
            </tr>
            <tr>
              <td className={`${tdClass} font-medium text-slate-900`}>5-Year</td>
              {rankingYears.map((y) => {
                const r = fiveYearRankByYear.get(y);
                if (!r) {
                  return (
                    <td key={y} className={`${numTdClass} text-slate-400`}>
                      —
                    </td>
                  );
                }
                return (
                  <td key={y} className={numTdClass}>
                    <Link
                      href={`/rankings/club-rankings/five-year?${new URLSearchParams({ endYear: String(r.endYear) })}`}
                      className="hover:underline"
                    >
                      <RankBadge rank={r.rank} />
                    </Link>
                  </td>
                );
              })}
            </tr>
            {rankingYears.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={1}>
                  No club rankings for this club yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 mb-2 text-lg font-medium">Teams</h2>
      {activeSeason && (
        <p className="mb-2 text-xs text-slate-500">
          Age and team # shown are for the active season ({activeSeason.label}).
        </p>
      )}
      <div className={tableWrapClass}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: brand.purple }}>
              <th className={thClass}>Name</th>
              <th className={numThClass}>Age</th>
              <th className={numThClass}>Team #</th>
              <th className={numThClass}>Elo</th>
              <th className={numThClass}>Combined Rank</th>
              <th className={thClass}>Seasons</th>
            </tr>
          </thead>
          <tbody className={tbodyClass}>
            {sortedTeams.map((t) => {
              const activeTs = activeSeason
                ? t.seasons.find((ts) => ts.seasonId === activeSeason.id)
                : undefined;
              return (
                <tr key={t.id} className="cursor-pointer">
                  <td className={`${primaryTdClass} relative`}>
                    <Link href={`/rankings/teams/${t.id}`} className="after:absolute after:inset-0 hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td className={numTdClass}>{activeTs ? `${activeTs.ageGroup}u` : ""}</td>
                  <td className={numTdClass}>{activeTs?.teamNumber ?? ""}</td>
                  <td className={numTdClass}>
                    <EloBadge rating={eloByTeamId.get(t.id)} />
                  </td>
                  <td className={numTdClass}>
                    <RankBadge rank={combinedRankByTeamId.get(t.id)} />
                  </td>
                  <td className={tdClass}>
                    {t.seasons.length === 0 && (
                      <span className="text-slate-400">Not enrolled in any season</span>
                    )}
                    <ul className="flex flex-col gap-0.5">
                      {t.seasons.map((ts) => (
                        <li key={ts.id} className="text-xs text-slate-600">
                          {ts.season.label}: {ts.ageGroup}u #{ts.teamNumber}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              );
            })}
            {sortedTeams.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={6}>
                  No teams for this club yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
