import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { tableClass, thClass, tdClass, scoringStatusBadgeClass } from "@/lib/ui";

export default async function PublicDivisionDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; divisionId: string }>;
}) {
  const { eventId, divisionId } = await params;

  // Sequential, not Promise.all -- see docs/dev-environment.md.
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    include: { event: true, pointBands: { orderBy: { fromRank: "asc" } } },
  });
  if (!division || division.eventId !== eventId) notFound();

  const seasonId = division.event.seasonId;
  const finishes = await prisma.teamFinish.findMany({
    where: { divisionId },
    include: { team: { include: { seasons: { where: { seasonId } } } } },
    orderBy: { rank: "asc" },
  });

  return (
    <div className="max-w-2xl">
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

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Point curve</h2>
        <table className={`${tableClass} mb-4`}>
          <thead>
            <tr>
              <th className={thClass}>From</th>
              <th className={thClass}>To</th>
              <th className={thClass}>Points</th>
            </tr>
          </thead>
          <tbody>
            {division.pointBands.map((b) => (
              <tr key={b.id}>
                <td className={tdClass}>{b.fromRank}</td>
                <td className={tdClass}>{b.toRank === 0 ? "+" : b.toRank}</td>
                <td className={tdClass}>{b.points}</td>
              </tr>
            ))}
            {division.pointBands.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={3}>
                  No bands yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Team finishes</h2>
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>Rank</th>
              <th className={thClass}>Team</th>
              <th className={thClass}>Age</th>
              <th className={thClass}>Ignore age</th>
              <th className={thClass}>Points</th>
            </tr>
          </thead>
          <tbody>
            {finishes.map((f) => (
              <tr key={f.id}>
                <td className={tdClass}>{f.rank}</td>
                <td className={tdClass}>{f.team.name}</td>
                <td className={tdClass}>{f.team.seasons[0]?.ageGroup}u</td>
                <td className={tdClass}>{f.ignoreAge ? "Yes" : ""}</td>
                <td className={tdClass}>{f.points ?? ""}</td>
              </tr>
            ))}
            {finishes.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={5}>
                  No team finishes entered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
