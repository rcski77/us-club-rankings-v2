import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { scoringStatusBadgeClass } from "@/lib/ui";
import { brand } from "@/lib/brand";
import { tableWrapClass, thClass, tdClass, numThClass, numTdClass, tbodyClass, RankBadge } from "@/lib/publicUi";
import { getEventEloSummaries } from "@/lib/rating/computeEloRatings";

export default async function PublicDivisionDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; divisionId: string }>;
}) {
  const { eventId, divisionId } = await params;

  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    include: { event: true },
  });
  if (!division || division.eventId !== eventId) notFound();

  const seasonId = division.event.seasonId;
  const finishes = await prisma.teamFinish.findMany({
    where: { divisionId },
    include: { team: { include: { seasons: { where: { seasonId } } } } },
    orderBy: { rank: "asc" },
  });
  // Sequential awaits (not Promise.all) -- see docs/dev-environment.md.
  const eloSummaries = await getEventEloSummaries(eventId, seasonId, division.ageGroup, division.event.endDate);

  return (
    <div className="max-w-4xl">
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/rankings/events" className="underline">
          Events
        </Link>{" "}
        /{" "}
        <Link href={`/rankings/events/${eventId}`} className="underline">
          {division.event.name}
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-semibold">{division.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {division.ageGroup}u · {division.tierLabel}
        {division.tierLevel ? ` ${division.tierLevel}` : ""} ·{" "}
        <span className={scoringStatusBadgeClass(division.scoringStatus)}>{division.scoringStatus}</span>
      </p>

      <section>
        <h2 className="mb-2 text-lg font-medium">Team finishes</h2>
        <div className={tableWrapClass}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ backgroundColor: brand.purple }}>
                <th className={numThClass}>Rank</th>
                <th className={thClass}>Team</th>
                <th className={thClass}>Code</th>
                <th className={numThClass}>Age</th>
                <th className={numThClass}>Ignore Age</th>
                <th className={numThClass}>Points</th>
                <th className={numThClass}>W-L</th>
                <th className={numThClass}>Elo Rating</th>
              </tr>
            </thead>
            <tbody className={tbodyClass}>
              {finishes.map((f) => {
                const elo = eloSummaries.get(f.team.id);
                return (
                  <tr key={f.id} className="relative cursor-pointer">
                    <td className={numTdClass}>
                      <RankBadge rank={f.rank} />
                    </td>
                    <td className={`${tdClass} font-medium text-slate-900`}>
                      <Link
                        href={`/rankings/teams/${f.team.id}`}
                        className="after:absolute after:inset-0 hover:underline"
                      >
                        {f.team.name}
                      </Link>
                    </td>
                    <td className={`${tdClass} text-slate-500`}>{f.team.seasons[0]?.externalTeamCode ?? ""}</td>
                    <td className={numTdClass}>{f.team.seasons[0]?.ageGroup}u</td>
                    <td className={numTdClass}>{f.ignoreAge ? "Yes" : ""}</td>
                    <td className={`${numTdClass} font-semibold`} style={{ color: brand.purple }}>
                      {f.points ?? ""}
                    </td>
                    <td className={numTdClass}>
                      {elo && elo.wins + elo.losses > 0 ? (
                        `${elo.wins}-${elo.losses}`
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={numTdClass}>
                      {elo?.rating !== undefined ? (
                        <>
                          <span className="font-semibold" style={{ color: brand.purple }}>
                            {Math.round(elo.rating)}
                          </span>
                          {elo.delta !== undefined && (
                            <span
                              className={`ml-1 font-mono text-xs font-semibold ${
                                elo.delta >= 0 ? "text-green-700" : "text-red-700"
                              }`}
                            >
                              ({elo.delta >= 0 ? "+" : ""}
                              {elo.delta.toFixed(0)})
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {finishes.length === 0 && (
                <tr>
                  <td className={tdClass} colSpan={8}>
                    No team finishes entered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
