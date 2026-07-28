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

  // Sequential, not Promise.all: the local dev Postgres (via `prisma dev`) doesn't
  // reliably handle concurrent queries from the same connection pool.
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

  // Sequential, not Promise.all -- see docs/dev-environment.md.
  const matchesAsA = await prisma.match.findMany({
    where: { teamAId: teamId },
    include: {
      event: { include: { season: true } },
      division: true,
      teamB: true,
    },
    orderBy: { matchDate: "desc" },
  });
  const matchesAsB = await prisma.match.findMany({
    where: { teamBId: teamId },
    include: {
      event: { include: { season: true } },
      division: true,
      teamA: true,
    },
    orderBy: { matchDate: "desc" },
  });
  // Normalize both sides into "this team" vs. "opponent" so the table doesn't need to
  // care which side of the match this team happened to be on.
  const matches = [
    ...matchesAsA.map((m) => ({ ...m, opponent: m.teamB, wonByThisTeam: m.winnerTeamId === teamId, opponentSets: m.setsB, thisTeamSets: m.setsA })),
    ...matchesAsB.map((m) => ({ ...m, opponent: m.teamA, wonByThisTeam: m.winnerTeamId === teamId, opponentSets: m.setsA, thisTeamSets: m.setsB })),
  ].sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0));
  const clubs = await prisma.club.findMany({ orderBy: { name: "asc" } });
  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });

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

  // Sequential, not Promise.all -- see docs/dev-environment.md. [] when the team has
  // no TeamSeason row for activeSeasonId (no natural age group to resolve from) or no
  // rated matches yet. Keyed by matchId so the Match Results table below can look up
  // "does this match have Elo data" per row rather than rendering two separate,
  // largely-duplicate match lists.
  const eloHistory = activeSeasonId ? await getTeamEloHistory(teamId, activeSeasonId) : [];
  const eloByMatchId = new Map(eloHistory.map((h) => [h.matchId, h]));

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
            <select name="clubId" className={selectClass} defaultValue={team.clubId ?? ""}>
              <option value="">(unlinked)</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
                          className="text-slate-900 underline"
                        >
                          {f.division.event.name}
                        </Link>
                      </td>
                      <td className={tdClass}>
                        <Link
                          href={`/admin/events/${f.division.eventId}/divisions/${f.division.id}`}
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
        <h2 className="mb-2 text-lg font-medium">Match Results ({matchesForSeason.length})</h2>

        {tabSeasons.length === 0 || matches.length === 0 ? (
          <p className="text-sm text-slate-500">
            No match results imported for this team yet — see{" "}
            <Link href="/admin/imports" className="underline">
              Imports
            </Link>{" "}
            (Match Results type).
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {matchesForSeason.map((m) => {
              const elo = eloByMatchId.get(m.id);
              return (
                <details key={m.id} className="rounded border border-slate-200">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-4 px-3 py-2 text-sm">
                    <span className="w-24 shrink-0 text-slate-500">
                      {m.matchDate ? m.matchDate.toISOString().slice(0, 10) : ""}
                    </span>
                    <span className="text-slate-500">{m.event.name}</span>
                    <span className="text-slate-500">{m.division?.name ?? ""}</span>
                    <span className={m.opponent ? "font-medium text-slate-900" : "font-medium text-slate-400"}>
                      {m.opponent?.name ?? "(unresolved)"}
                    </span>
                    <span className="text-slate-500">
                      {m.thisTeamSets}-{m.opponentSets}
                    </span>
                    {m.winnerTeamId && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-semibold text-white ${
                          m.wonByThisTeam ? "bg-green-600" : "bg-red-600"
                        }`}
                      >
                        {m.wonByThisTeam ? "W" : "L"}
                      </span>
                    )}
                    {elo ? (
                      <>
                        <span className="ml-auto font-mono text-xs text-slate-500">
                          {elo.ratingBefore.toFixed(0)} → {elo.ratingAfter.toFixed(0)}
                        </span>
                        <span
                          className={`w-14 text-right font-mono text-xs font-semibold ${
                            elo.delta >= 0 ? "text-green-700" : "text-red-700"
                          }`}
                        >
                          {elo.delta >= 0 ? "+" : ""}
                          {elo.delta.toFixed(0)}
                        </span>
                      </>
                    ) : (
                      <span className="ml-auto text-xs text-slate-400">No Elo data</span>
                    )}
                  </summary>
                  <div className="border-t border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Opponent</span>
                        <span>
                          {m.opponent ? (
                            <Link href={`/admin/teams/${m.opponent.id}`} className="underline">
                              {m.opponent.name}
                            </Link>
                          ) : (
                            "(unresolved)"
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Stage</span>
                        <span>{m.stage ?? "—"}</span>
                      </div>
                      {elo && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Rating</span>
                            <span>
                              {elo.ratingBefore.toFixed(0)} → {elo.ratingAfter.toFixed(0)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Opponent rating</span>
                            <span>{elo.opponentRatingBefore.toFixed(0)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Win expectation</span>
                            <span>{(elo.expected * 100).toFixed(0)}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Matchup volatility (K)</span>
                            <span>{elo.k}</span>
                          </div>
                        </>
                      )}
                    </div>
                    {elo ? (
                      <p className="mt-2 text-xs text-slate-600">
                        <span className="font-medium">Why your Elo changed: </span>
                        {elo.explanation}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">
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
            {matchesForSeason.length === 0 && (
              <p className="text-sm text-slate-500">No match results for this season.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
