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
} from "@/lib/publicUi";
import { getLatestPowerRatings, computeCombinedRankByTeam } from "@/lib/rating/powerRankings";

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

  const activeSeason = await prisma.season.findFirst({ where: { isActive: true } });

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

      <h2 className="mb-2 text-lg font-medium">Teams</h2>
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
                <tr key={t.id} className="relative cursor-pointer">
                  <td className={primaryTdClass}>
                    <Link href={`/rankings/teams/${t.id}`} className="after:absolute after:inset-0 hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td className={numTdClass}>{activeTs ? `${activeTs.ageGroup}u` : ""}</td>
                  <td className={numTdClass}>{activeTs?.teamNumber ?? ""}</td>
                  <td className={numTdClass}>
                    {eloByTeamId.has(t.id) ? Math.round(eloByTeamId.get(t.id)!) : <span className="text-slate-400">—</span>}
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
