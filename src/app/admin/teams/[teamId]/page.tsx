import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import {
  tableClass,
  thClass,
  tdClass,
  inputClass,
  selectClass,
  primaryButtonClass,
  secondaryButtonClass,
  smallSecondaryButtonClass,
  errorBannerClass,
} from "@/lib/ui";
import { getTeamEloHistory } from "@/lib/rating/computeEloRatings";
import { ClubCombobox } from "@/components/ClubCombobox";

async function updateTeam(teamId: string, formData: FormData) {
  "use server";

  const clubId = String(formData.get("clubId") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();

  if (!name) redirect(`/admin/teams/${teamId}?error=invalid`);

  await prisma.team.update({ where: { id: teamId }, data: { clubId, name } });
  revalidatePath(`/admin/teams/${teamId}`);
}

async function addTeamSeason(teamId: string, formData: FormData) {
  "use server";

  const seasonId = String(formData.get("seasonId") ?? "");
  const ageGroup = Number(formData.get("ageGroup"));
  const teamNumber = String(formData.get("teamNumber") ?? "").trim();
  const externalTeamCode = String(formData.get("externalTeamCode") ?? "").trim() || null;

  if (!seasonId || !ageGroup || !teamNumber) {
    redirect(`/admin/teams/${teamId}?error=season-invalid`);
  }

  const existing = await prisma.teamSeason.findUnique({
    where: { teamId_seasonId: { teamId, seasonId } },
  });
  if (existing) redirect(`/admin/teams/${teamId}?error=season-exists`);

  await prisma.teamSeason.create({
    data: { teamId, seasonId, ageGroup, teamNumber, externalTeamCode },
  });
  revalidatePath(`/admin/teams/${teamId}`);
}

async function removeTeamSeason(teamId: string, teamSeasonId: string) {
  "use server";
  await prisma.teamSeason.delete({ where: { id: teamSeasonId } });
  revalidatePath(`/admin/teams/${teamId}`);
}

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ error?: string; season?: string }>;
}) {
  const { teamId } = await params;
  const { error, season: seasonParam } = await searchParams;

  // team, matchesAsA/B, clubs, and seasons don't depend on each other's results, so
  // they run as one batch instead of five sequential round trips.
  // matchesAsA/B are capped at 500 as a stopgap -- a team with more matches than that
  // in its full history would need the season-tab derivation below reworked to filter
  // in the DB instead of in JS; not attempted in this pass.
  const [team, matchesAsA, matchesAsB, clubs, seasons] = await Promise.all([
    prisma.team.findUnique({
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
    }),
    prisma.match.findMany({
      where: { teamAId: teamId },
      include: {
        event: { include: { season: true } },
        division: true,
        teamB: true,
      },
      orderBy: { matchDate: "desc" },
      take: 500,
    }),
    prisma.match.findMany({
      where: { teamBId: teamId },
      include: {
        event: { include: { season: true } },
        division: true,
        teamA: true,
      },
      orderBy: { matchDate: "desc" },
      take: 500,
    }),
    prisma.club.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.season.findMany({ orderBy: { startDate: "desc" } }),
  ]);
  if (!team) notFound();
  // Normalize both sides into "this team" vs. "opponent" so the table doesn't need to
  // care which side of the match this team happened to be on. thisTeamIsA also lets
  // the per-set score display (setScores is stored as {a, b} = teamA/teamB points,
  // regardless of which side "this team" was on) reorient into "this team's points"
  // vs. "opponent's points" per set.
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

  const enrolledSeasonIds = new Set(team.seasons.map((ts) => ts.seasonId));
  const availableSeasons = seasons.filter((s) => !enrolledSeasonIds.has(s.id));

  // Season tabs: any season the team is enrolled in, plus any season it has a finish
  // or match result in (a team can have results recorded before/without an explicit
  // TeamSeason row).
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

  // Depends on activeSeasonId (derived above from team/matches), so stays sequential.
  // [] when the team has no TeamSeason row for activeSeasonId (no natural age group to
  // resolve from) or no rated matches yet. Keyed by matchId so the Match Results table
  // below can look up "does this match have Elo data" per row rather than rendering
  // two separate, largely-duplicate match lists.
  const eloHistory = activeSeasonId ? await getTeamEloHistory(teamId, activeSeasonId) : [];
  const eloByMatchId = new Map(eloHistory.map((h) => [h.matchId, h]));

  // Group matches by event for display -- staff think in terms of "how did we do at
  // this tournament," not one long flat match list (mirrors a pattern seen on a
  // competitor site). Groups appear in the same most-recent-first order as
  // matchesForSeason itself (first match encountered per event sets its group's
  // position); matches *within* a group are re-sorted chronologically ascending so a
  // multi-day event reads day-1-morning-to-day-2-afternoon, not newest-first.
  type MatchRow = (typeof matchesForSeason)[number];
  type EventGroup = {
    event: MatchRow["event"];
    divisionNames: string[];
    matches: MatchRow[];
    wins: number;
    losses: number;
    eloDeltaTotal: number | undefined; // undefined = no Elo data for any match in this event
  };
  const eventGroupsById = new Map<string, EventGroup>();
  for (const m of matchesForSeason) {
    let group = eventGroupsById.get(m.eventId);
    if (!group) {
      group = { event: m.event, divisionNames: [], matches: [], wins: 0, losses: 0, eloDeltaTotal: undefined };
      eventGroupsById.set(m.eventId, group);
    }
    group.matches.push(m);
    if (m.division && !group.divisionNames.includes(m.division.name)) group.divisionNames.push(m.division.name);
    if (m.winnerTeamId) {
      if (m.wonByThisTeam) group.wins += 1;
      else group.losses += 1;
    }
    const elo = eloByMatchId.get(m.id);
    if (elo) group.eloDeltaTotal = (group.eloDeltaTotal ?? 0) + elo.delta;
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

  const updateTeamWithId = updateTeam.bind(null, teamId);
  const addTeamSeasonWithId = addTeamSeason.bind(null, teamId);

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/teams" className="underline">
          Teams
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">{team.name}</h1>

      {error === "invalid" && <p className={errorBannerClass}>Name is required.</p>}
      {error === "season-invalid" && (
        <p className={errorBannerClass}>Season, age group, and team number are required.</p>
      )}
      {error === "season-exists" && (
        <p className={errorBannerClass}>This team is already enrolled in that season.</p>
      )}

      <section className="mb-8 max-w-lg">
        <h2 className="mb-2 text-lg font-medium">Edit team</h2>
        <form action={updateTeamWithId} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input name="name" defaultValue={team.name} required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Club
            <ClubCombobox clubs={clubs} name="clubId" defaultClubId={team.clubId} />
          </label>
          <button type="submit" className={`${primaryButtonClass} self-start`}>
            Save
          </button>
        </form>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Seasons</h2>
        <table className={`${tableClass} mb-4`}>
          <thead>
            <tr>
              <th className={thClass}>Season</th>
              <th className={thClass}>Age</th>
              <th className={thClass}>#</th>
              <th className={thClass}>Code</th>
              <th className={thClass}></th>
            </tr>
          </thead>
          <tbody>
            {team.seasons.map((ts) => (
              <tr key={ts.id}>
                <td className={tdClass}>{ts.season.label}</td>
                <td className={tdClass}>{ts.ageGroup}u</td>
                <td className={tdClass}>{ts.teamNumber}</td>
                <td className={`${tdClass} font-mono text-xs text-slate-500`}>
                  {ts.externalTeamCode ?? ""}
                </td>
                <td className={tdClass}>
                  <form
                    action={async () => {
                      "use server";
                      await removeTeamSeason(teamId, ts.id);
                    }}
                  >
                    <button type="submit" className={smallSecondaryButtonClass}>
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {team.seasons.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={5}>
                  Not enrolled in any season yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {availableSeasons.length > 0 && (
          <form action={addTeamSeasonWithId} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Season
              <select name="seasonId" className={selectClass} defaultValue="">
                <option value="" disabled>
                  Select a season…
                </option>
                {availableSeasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Age group
              <input
                name="ageGroup"
                type="number"
                min={10}
                max={18}
                required
                className={`${inputClass} w-20`}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Team #
              <input
                name="teamNumber"
                defaultValue="1"
                required
                className={`${inputClass} w-20`}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Code
              <input
                name="externalTeamCode"
                placeholder="g14frogs1nt"
                className={`${inputClass} w-32`}
              />
            </label>
            <button type="submit" className={secondaryButtonClass}>
              Add season
            </button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Finishes</h2>

        {tabSeasons.length === 0 ? (
          <p className="text-sm text-slate-500">No finishes yet.</p>
        ) : (
          <>
            <div className="mb-3 flex gap-1 border-b">
              {tabSeasons.map((s) => (
                <Link
                  key={s.id}
                  href={`/admin/teams/${teamId}?season=${s.id}`}
                  prefetch={false}
                  className={
                    s.id === activeSeasonId
                      ? "-mb-px rounded-t border border-b-0 bg-white px-3 py-1.5 text-sm font-medium"
                      : "-mb-px rounded-t border border-transparent px-3 py-1.5 text-sm text-slate-500 hover:text-slate-900"
                  }
                >
                  {s.label}
                </Link>
              ))}
            </div>

            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>Event</th>
                  <th className={thClass}>Division</th>
                  <th className={thClass}>Tier</th>
                  <th className={thClass}>Place</th>
                  <th className={thClass}>Points</th>
                  <th className={thClass}>Max Points</th>
                </tr>
              </thead>
              <tbody>
                {finishesForSeason.map((f) => {
                  const maxPoints = f.division.pointBands.length
                    ? Math.max(...f.division.pointBands.map((b) => b.points))
                    : null;
                  return (
                    <tr key={f.id}>
                      <td className={tdClass}>
                        <Link
                          href={`/admin/events/${f.division.eventId}`}
                          prefetch={false}
                          className="text-slate-900 underline"
                        >
                          {f.division.event.name}
                        </Link>
                      </td>
                      <td className={tdClass}>
                        <Link
                          href={`/admin/events/${f.division.eventId}/divisions/${f.division.id}`}
                          prefetch={false}
                          className="text-slate-900 underline"
                        >
                          {f.division.name}
                        </Link>
                      </td>
                      <td className={tdClass}>
                        {f.division.tierLabel}
                        {f.division.tierLevel ? ` ${f.division.tierLevel}` : ""}
                      </td>
                      <td className={tdClass}>{f.rank}</td>
                      <td className={tdClass}>{f.points ?? ""}</td>
                      <td className={tdClass}>{maxPoints ?? ""}</td>
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
          <p className="text-sm text-slate-500">
            No match results imported for this team yet — see{" "}
            <Link href="/admin/imports" className="underline">
              Imports
            </Link>{" "}
            (Match Results type).
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {eventGroups.map((g) => (
              <details key={g.event.id} className="rounded border border-slate-200" open={eventGroups.length === 1}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-3 py-2">
                  <span>
                    <Link
                      href={`/admin/events/${g.event.id}`}
                      prefetch={false}
                      className="font-medium text-slate-900 underline"
                    >
                      {g.event.name}
                    </Link>
                    <span className="ml-2 text-xs text-slate-500">
                      {formatEventDateRange(g.event.startDate, g.event.endDate)}
                      {g.divisionNames.length > 0 && <> • {g.divisionNames.join(", ")}</>}
                    </span>
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700">
                      Wins: {g.wins}
                    </span>
                    <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                      Losses: {g.losses}
                    </span>
                    {g.eloDeltaTotal !== undefined && (
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono font-medium ${
                          g.eloDeltaTotal >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                        }`}
                      >
                        Elo {g.eloDeltaTotal >= 0 ? "+" : ""}
                        {g.eloDeltaTotal.toFixed(0)}
                      </span>
                    )}
                    <span className="text-slate-400">
                      {g.matches.length} match{g.matches.length === 1 ? "" : "es"}
                    </span>
                  </span>
                </summary>

                <div className="border-t border-slate-200 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-4 px-3 py-1 text-xs font-medium text-slate-500">
                    <span className="w-20 shrink-0">Date</span>
                    <span className="w-14 shrink-0">Time</span>
                    <span className="min-w-32 flex-1">Opponent</span>
                    <span className="w-12 shrink-0">Score</span>
                    <span className="w-8 shrink-0">Result</span>
                    <span className="min-w-32 flex-1">Set Scores</span>
                    <span className="w-14 shrink-0 text-right">Elo Δ</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {g.matches.map((m) => {
                      const elo = eloByMatchId.get(m.id);
                      return (
                        <details key={m.id} className="rounded border border-slate-100">
                          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-4 px-3 py-2 text-sm">
                            <span className="w-20 shrink-0 text-slate-500">
                              {m.matchDate ? m.matchDate.toISOString().slice(0, 10) : "—"}
                            </span>
                            <span className="w-14 shrink-0 text-slate-500">
                              {m.matchDate ? m.matchDate.toISOString().slice(11, 16) : "—"}
                            </span>
                            <span className="min-w-32 flex-1 font-medium">
                              {m.opponent ? (
                                <Link href={`/admin/teams/${m.opponent.id}`} prefetch={false} className="text-slate-900 underline">
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
                          </summary>
                          <div className="border-t border-slate-100 bg-slate-50 px-3 py-3 text-sm">
                            {elo ? (
                              <>
                                <div className="mb-2 flex items-center justify-between">
                                  <span className="text-xs font-semibold text-slate-700">
                                    Why your Elo changed
                                  </span>
                                  <span
                                    className={`font-mono text-xs font-semibold ${
                                      elo.delta >= 0 ? "text-green-700" : "text-red-700"
                                    }`}
                                  >
                                    {elo.delta >= 0 ? "+" : ""}
                                    {elo.delta.toFixed(0)}
                                  </span>
                                </div>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Rating</span>
                                    <span>
                                      {elo.ratingBefore.toFixed(0)} → {elo.ratingAfter.toFixed(0)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Opponent rating</span>
                                    <span>
                                      {elo.opponentRatingBefore.toFixed(0)} ({elo.opponentStrength})
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Win expectation</span>
                                    <span>{(elo.expected * 100).toFixed(0)}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Result</span>
                                    <span>{elo.resultLabel}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Matchup volatility (K)</span>
                                    <span>
                                      {elo.k} → {(elo.k * elo.multiplier * elo.effectiveWeight).toFixed(1)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-slate-500">Division</span>
                                    <span>{elo.divisionTierLabel ?? "—"}</span>
                                  </div>
                                </div>
                                {elo.divisionEffectExplanation && (
                                  <p className="mt-2 text-xs text-slate-600">{elo.divisionEffectExplanation}</p>
                                )}
                                <p className="mt-2 text-xs text-slate-600">{elo.explanation}</p>
                              </>
                            ) : (
                              <p className="text-xs text-slate-400">
                                This match isn&apos;t part of the current Elo rating graph yet — run
                                &quot;Recompute Elo ratings&quot; from{" "}
                                <Link href="/admin/team-rankings" className="underline">
                                  Team Rankings
                                </Link>
                                .
                              </p>
                            )}
                          </div>
                        </details>
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
