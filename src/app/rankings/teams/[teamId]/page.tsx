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
  rowListClass,
  StatTile,
  TrophyIcon,
  TrendUpIcon,
  RecordIcon,
} from "@/lib/publicUi";
import { getTeamEloHistory } from "@/lib/rating/computeEloRatings";

export default async function PublicTeamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { teamId } = await params;
  const { season: seasonParam } = await searchParams;

  // Sequential, not Promise.all -- see docs/dev-environment.md.
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      club: true,
      seasons: { include: { season: true }, orderBy: { season: { startDate: "desc" } } },
      finishes: {
        include: {
          division: { include: { event: { include: { season: true } }, pointBands: true } },
        },
        orderBy: { division: { event: { startDate: "desc" } } },
      },
    },
  });
  if (!team) notFound();

  const matchesAsA = await prisma.match.findMany({
    where: { teamAId: teamId },
    include: { event: { include: { season: true } }, division: true, teamB: true },
    orderBy: { matchDate: "desc" },
  });
  const matchesAsB = await prisma.match.findMany({
    where: { teamBId: teamId },
    include: { event: { include: { season: true } }, division: true, teamA: true },
    orderBy: { matchDate: "desc" },
  });
  const matches = [
    ...matchesAsA.map((m) => ({
      ...m,
      opponent: m.teamB,
      wonByThisTeam: m.winnerTeamId === teamId,
      opponentSets: m.setsB,
      thisTeamSets: m.setsA,
      thisTeamIsA: true,
    })),
    ...matchesAsB.map((m) => ({
      ...m,
      opponent: m.teamA,
      wonByThisTeam: m.winnerTeamId === teamId,
      opponentSets: m.setsA,
      thisTeamSets: m.setsB,
      thisTeamIsA: false,
    })),
  ].sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0));

  const finishSeasons = new Map(team.finishes.map((f) => [f.division.event.season.id, f.division.event.season]));
  const matchSeasons = new Map(matches.map((m) => [m.event.season.id, m.event.season]));
  const tabSeasons = [...team.seasons.map((ts) => ts.season), ...finishSeasons.values(), ...matchSeasons.values()]
    .filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i)
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

  const activeSeasonId =
    (seasonParam && tabSeasons.some((s) => s.id === seasonParam) ? seasonParam : undefined) ??
    tabSeasons.find((s) => s.isActive)?.id ??
    tabSeasons[0]?.id;

  const finishesForSeason = team.finishes.filter((f) => f.division.event.season.id === activeSeasonId);
  const matchesForSeason = matches.filter((m) => m.event.season.id === activeSeasonId);

  const eloHistory = activeSeasonId ? await getTeamEloHistory(teamId, activeSeasonId) : [];
  const eloByMatchId = new Map(eloHistory.map((h) => [h.matchId, h]));

  const activeAgeGroup = team.seasons.find((ts) => ts.season.id === activeSeasonId)?.ageGroup;

  // Sequential, not Promise.all -- see docs/dev-environment.md.
  const npsResult =
    activeSeasonId && activeAgeGroup !== undefined
      ? await prisma.rankingResult.findUnique({
          where: { seasonId_ageGroup_teamId: { seasonId: activeSeasonId, ageGroup: activeAgeGroup, teamId } },
        })
      : null;
  const latestElo =
    activeSeasonId && activeAgeGroup !== undefined
      ? await prisma.teamRatingHistory.findFirst({
          where: { teamId, seasonId: activeSeasonId, ageGroup: activeAgeGroup, ratingEngine: "ELO" },
          orderBy: { weekEndingDate: "desc" },
        })
      : null;

  type MatchRow = (typeof matchesForSeason)[number];
  type EventGroup = {
    event: MatchRow["event"];
    divisionNames: string[];
    matches: MatchRow[];
    wins: number;
    losses: number;
  };
  const eventGroupsById = new Map<string, EventGroup>();
  for (const m of matchesForSeason) {
    let group = eventGroupsById.get(m.eventId);
    if (!group) {
      group = { event: m.event, divisionNames: [], matches: [], wins: 0, losses: 0 };
      eventGroupsById.set(m.eventId, group);
    }
    group.matches.push(m);
    if (m.division && !group.divisionNames.includes(m.division.name)) group.divisionNames.push(m.division.name);
    if (m.winnerTeamId) {
      if (m.wonByThisTeam) group.wins += 1;
      else group.losses += 1;
    }
  }
  const eventGroups = Array.from(eventGroupsById.values());
  for (const group of eventGroups) {
    group.matches.sort((a, b) => (a.matchDate?.getTime() ?? 0) - (b.matchDate?.getTime() ?? 0));
  }
  const seasonWins = eventGroups.reduce((sum, g) => sum + g.wins, 0);
  const seasonLosses = eventGroups.reduce((sum, g) => sum + g.losses, 0);

  function formatSetScores(m: MatchRow): string {
    const sets = Array.isArray(m.setScores) ? (m.setScores as unknown as { a: number; b: number }[]) : [];
    if (sets.length === 0) return "—";
    return sets.map((s) => (m.thisTeamIsA ? `${s.a}-${s.b}` : `${s.b}-${s.a}`)).join(", ");
  }

  function formatEventDateRange(start: Date, end: Date): string {
    const sameDay = start.toDateString() === end.toDateString();
    const startStr = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (sameDay) return `${startStr}, ${start.getFullYear()}`;
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const endStr = sameMonth
      ? String(end.getDate())
      : end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${startStr}–${endStr}, ${end.getFullYear()}`;
  }

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/rankings/team-rankings" className="underline">
          Team Rankings
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-semibold">{team.name}</h1>
      {team.club && (
        <p className="mb-4 text-sm text-slate-500">
          <Link href={`/rankings/clubs/${team.club.id}`} className="underline">
            {team.club.name}
          </Link>
        </p>
      )}

      {activeAgeGroup !== undefined && (
        <div className="mb-6 flex flex-wrap gap-3">
          <StatTile
            icon={<TrophyIcon />}
            label={`U${activeAgeGroup}`}
            value={npsResult ? `#${npsResult.rank}` : "—"}
            valueClassName="text-amber-500"
          />
          <StatTile
            icon={<TrendUpIcon />}
            label="Elo"
            value={latestElo ? Math.round(latestElo.rating) : "—"}
            valueClassName="text-blue-600"
          />
          <StatTile
            icon={<RecordIcon />}
            label="Record"
            value={`${seasonWins}-${seasonLosses}`}
            valueClassName={seasonLosses === 0 && seasonWins > 0 ? "text-green-600" : "text-slate-900"}
          />
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Finishes</h2>

        {tabSeasons.length === 0 ? (
          <p className="text-sm text-slate-500">No finishes yet.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {tabSeasons.map((s) => (
                <Link
                  key={s.id}
                  href={`/rankings/teams/${teamId}?season=${s.id}`}
                  className={
                    s.id === activeSeasonId
                      ? "rounded-full px-3 py-1 text-xs font-semibold text-white"
                      : "rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  }
                  style={s.id === activeSeasonId ? { backgroundColor: brand.teal } : undefined}
                >
                  {s.label}
                </Link>
              ))}
            </div>

            <div className={tableWrapClass}>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr style={{ backgroundColor: brand.purple }}>
                    <th className={thClass}>Event</th>
                    <th className={thClass}>Division</th>
                    <th className={thClass}>Tier</th>
                    <th className={numThClass}>Place</th>
                    <th className={numThClass}>Points</th>
                    <th className={numThClass}>Max Points</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {finishesForSeason.map((f) => {
                    const maxPoints = f.division.pointBands.length
                      ? Math.max(...f.division.pointBands.map((b) => b.points))
                      : null;
                    return (
                      <tr key={f.id}>
                        <td className={primaryTdClass}>
                          <Link href={`/rankings/events/${f.division.eventId}`} className="hover:underline">
                            {f.division.event.name}
                          </Link>
                        </td>
                        <td className={`${tdClass} text-slate-500`}>
                          <Link
                            href={`/rankings/events/${f.division.eventId}/divisions/${f.division.id}`}
                            className="hover:underline"
                          >
                            {f.division.name}
                          </Link>
                        </td>
                        <td className={`${tdClass} text-slate-500`}>
                          {f.division.tierLabel}
                          {f.division.tierLevel ? ` ${f.division.tierLevel}` : ""}
                        </td>
                        <td className={numTdClass}>{f.rank}</td>
                        <td className={`${numTdClass} font-semibold`} style={{ color: brand.purple }}>
                          {f.points ?? ""}
                        </td>
                        <td className={numTdClass}>{maxPoints ?? ""}</td>
                      </tr>
                    );
                  })}
                  {finishesForSeason.length === 0 && (
                    <tr>
                      <td className={tdClass} colSpan={6}>
                        No finishes for this season.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-2 text-lg font-medium">
          Match Results ({matchesForSeason.length} across {eventGroups.length} event
          {eventGroups.length === 1 ? "" : "s"})
        </h2>

        {matchesForSeason.length > 0 && (
          <div className="mb-3 flex gap-4 text-sm font-medium">
            <span className="text-slate-500">Total: {matchesForSeason.length}</span>
            <span className="text-green-700">Wins: {seasonWins}</span>
            <span className="text-red-700">Losses: {seasonLosses}</span>
          </div>
        )}

        {tabSeasons.length === 0 || matches.length === 0 ? (
          <p className="text-sm text-slate-500">No match results for this team yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {eventGroups.map((g) => (
              <details
                key={g.event.id}
                className={`${tableWrapClass} [&_summary::-webkit-details-marker]:hidden`}
                open={eventGroups.length === 1}
              >
                <summary
                  className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 text-white"
                  style={{ backgroundColor: brand.purple }}
                >
                  <span>
                    <Link href={`/rankings/events/${g.event.id}`} className="font-semibold hover:underline">
                      {g.event.name}
                    </Link>
                    <span className="ml-2 text-xs text-white/70">
                      {formatEventDateRange(g.event.startDate, g.event.endDate)}
                      {g.divisionNames.length > 0 && <> • {g.divisionNames.join(", ")}</>}
                    </span>
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-green-400/20 px-2 py-0.5 font-medium text-green-100">
                      Wins: {g.wins}
                    </span>
                    <span className="rounded-full bg-red-400/20 px-2 py-0.5 font-medium text-red-100">
                      Losses: {g.losses}
                    </span>
                    <span className="text-white/60">
                      {g.matches.length} match{g.matches.length === 1 ? "" : "es"}
                    </span>
                  </span>
                </summary>

                <div className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-4 px-3 py-1 text-xs font-medium text-slate-500">
                    <span className="w-20 shrink-0">Date</span>
                    <span className="min-w-32 flex-1">Opponent</span>
                    <span className="w-12 shrink-0">Score</span>
                    <span className="w-8 shrink-0">Result</span>
                    <span className="min-w-32 flex-1">Set Scores</span>
                    <span className="w-14 shrink-0 text-right">Elo Δ</span>
                  </div>
                  <div className={rowListClass}>
                    {g.matches.map((m) => {
                      const elo = eloByMatchId.get(m.id);
                      return (
                        <div key={m.id} className="flex flex-wrap items-center gap-4 px-3 py-2 text-sm">
                          <span className="w-20 shrink-0 text-slate-500">
                            {m.matchDate ? m.matchDate.toISOString().slice(0, 10) : "—"}
                          </span>
                          <span className="min-w-32 flex-1 font-medium text-slate-900">
                            {m.opponent ? (
                              <Link href={`/rankings/teams/${m.opponent.id}`} className="hover:underline">
                                {m.opponent.name}
                              </Link>
                            ) : (
                              <span className="text-slate-400">(unresolved)</span>
                            )}
                          </span>
                          <span className="w-12 shrink-0 text-slate-500">
                            {m.thisTeamSets}-{m.opponentSets}
                          </span>
                          <span className="w-8 shrink-0">
                            {m.winnerTeamId && (
                              <span
                                className={`rounded px-1.5 py-0.5 text-xs font-semibold text-white ${
                                  m.wonByThisTeam ? "bg-green-600" : "bg-red-600"
                                }`}
                              >
                                {m.wonByThisTeam ? "W" : "L"}
                              </span>
                            )}
                          </span>
                          <span className="min-w-32 flex-1 font-mono text-xs text-slate-500">
                            {formatSetScores(m)}
                          </span>
                          {elo ? (
                            <span
                              className={`w-14 shrink-0 text-right font-mono text-xs font-semibold ${
                                elo.delta >= 0 ? "text-green-700" : "text-red-700"
                              }`}
                            >
                              {elo.delta >= 0 ? "+" : ""}
                              {elo.delta.toFixed(0)}
                            </span>
                          ) : (
                            <span className="w-14 shrink-0 text-right text-xs text-slate-400">—</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            ))}
            {matchesForSeason.length === 0 && (
              <p className="text-sm text-slate-500">No match results for this season.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
