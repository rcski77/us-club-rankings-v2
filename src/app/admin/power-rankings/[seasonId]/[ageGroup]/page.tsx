import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { tableClass, thClass, tdClass } from "@/lib/ui";

export default async function PowerRankingResultsPage({
  params,
}: {
  params: Promise<{ seasonId: string; ageGroup: string }>;
}) {
  const { seasonId, ageGroup: ageGroupParam } = await params;
  const ageGroup = Number(ageGroupParam);

  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season || !ageGroup) notFound();

  // Each engine is recomputed on its own trigger, so its own latest weekEndingDate is
  // found independently rather than assuming the two runs share a date. Sequential
  // awaits throughout (not Promise.all) -- see docs/dev-environment.md.
  const latestColley = await prisma.teamRatingHistory.findFirst({
    where: { seasonId, ageGroup, ratingEngine: "COLLEY" },
    orderBy: { weekEndingDate: "desc" },
    select: { weekEndingDate: true },
  });
  const latestElo = await prisma.teamRatingHistory.findFirst({
    where: { seasonId, ageGroup, ratingEngine: "ELO" },
    orderBy: { weekEndingDate: "desc" },
    select: { weekEndingDate: true },
  });

  const colleyRatings = latestColley
    ? await prisma.teamRatingHistory.findMany({
        where: { seasonId, ageGroup, ratingEngine: "COLLEY", weekEndingDate: latestColley.weekEndingDate },
        include: { team: { include: { club: true } } },
        orderBy: { rank: "asc" },
      })
    : [];
  const eloRatings = latestElo
    ? await prisma.teamRatingHistory.findMany({
        where: { seasonId, ageGroup, ratingEngine: "ELO", weekEndingDate: latestElo.weekEndingDate },
        include: { team: { include: { club: true } } },
      })
    : [];

  const eloByTeam = new Map(eloRatings.map((r) => [r.teamId, r]));

  // Merged row list: every team rated by either engine. Colley-rated teams come
  // first, in Colley rank order (today's larger/more-established rating source), then
  // any Elo-only team (a division with imported matches but not yet a full standings
  // import) appended in Elo rank order.
  const colleyTeamIds = new Set(colleyRatings.map((r) => r.teamId));
  const eloOnly = eloRatings
    .filter((r) => !colleyTeamIds.has(r.teamId))
    .sort((a, b) => a.rank - b.rank);

  const rows = [
    ...colleyRatings.map((c) => ({ team: c.team, colley: c, elo: eloByTeam.get(c.teamId) })),
    ...eloOnly.map((e) => ({ team: e.team, colley: undefined, elo: e })),
  ];

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/power-rankings" className="underline">
          Power Rankings
        </Link>
      </div>
      <h1 className="mb-2 text-2xl font-semibold">
        {season.label} · {ageGroup}u Power Rankings
      </h1>
      <div className="mb-6 flex items-center gap-4 text-sm text-slate-500">
        {latestColley && <span>Colley as of {latestColley.weekEndingDate.toLocaleDateString()}</span>}
        {latestElo && <span>Elo as of {latestElo.weekEndingDate.toLocaleDateString()}</span>}
      </div>

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Team</th>
            <th className={thClass}>Club</th>
            <th className={thClass}>Colley Rank</th>
            <th className={thClass}>Colley Rating</th>
            <th className={thClass}>Comparisons</th>
            <th className={thClass}>Elo Rank</th>
            <th className={thClass}>Elo Rating</th>
            <th className={thClass}>Matches</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ team, colley, elo }) => (
            <tr key={team.id}>
              <td className={tdClass}>
                <Link href={`/admin/teams/${team.id}`} className="text-slate-900 underline">
                  {team.name}
                </Link>
              </td>
              <td className={tdClass}>{team.club?.name ?? ""}</td>
              <td className={tdClass}>{colley?.rank ?? "—"}</td>
              <td className={tdClass}>{colley ? colley.rating.toFixed(4) : "—"}</td>
              <td className={tdClass}>{colley?.comparisons ?? "—"}</td>
              <td className={tdClass}>{elo?.rank ?? "—"}</td>
              <td className={tdClass}>{elo ? elo.rating.toFixed(4) : "—"}</td>
              <td className={tdClass}>{elo?.comparisons ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={8}>
                No ratings yet — run &quot;Recompute Colley ratings&quot; or &quot;Recompute Elo
                ratings&quot; from the Power Rankings page.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
