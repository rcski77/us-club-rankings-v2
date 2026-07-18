import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { tableClass, thClass, tdClass } from "@/lib/ui";

export default async function RankingResultsPage({
  params,
}: {
  params: Promise<{ seasonId: string; ageGroup: string }>;
}) {
  const { seasonId, ageGroup: ageGroupParam } = await params;
  const ageGroup = Number(ageGroupParam);

  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season || !ageGroup) notFound();

  const results = await prisma.rankingResult.findMany({
    where: { seasonId, ageGroup },
    include: {
      team: { include: { club: true } },
      contributions: {
        include: { teamFinish: { include: { division: { include: { event: true } } } } },
        orderBy: { rankInSeason: "asc" },
      },
    },
    orderBy: { rank: "asc" },
  });

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/rankings" className="underline">
          Rankings
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">
        {season.label} · {ageGroup}u Rankings
      </h1>

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Rank</th>
            <th className={thClass}>Team</th>
            <th className={thClass}>Club</th>
            <th className={thClass}>Total Points</th>
            <th className={thClass}></th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.id}>
              <td className={tdClass}>{r.rank}</td>
              <td className={tdClass}>{r.team.name}</td>
              <td className={tdClass}>{r.team.club?.name ?? ""}</td>
              <td className={tdClass}>{r.totalPoints}</td>
              <td className={tdClass}>
                <details>
                  <summary className="cursor-pointer text-slate-500">
                    {r.contributions.length} finish{r.contributions.length === 1 ? "" : "es"}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-600">
                    {r.contributions.map((c) => (
                      <li key={c.id} className={c.countedInTop3 ? "" : "line-through opacity-50"}>
                        {c.teamFinish.division.event.name} ({c.teamFinish.division.name}):{" "}
                        {c.points} pts
                      </li>
                    ))}
                  </ul>
                </details>
              </td>
            </tr>
          ))}
          {results.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={5}>
                No ranked teams yet for this season/age group.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
