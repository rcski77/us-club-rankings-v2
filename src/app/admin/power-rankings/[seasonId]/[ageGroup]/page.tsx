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

  const latest = await prisma.teamRatingHistory.findFirst({
    where: { seasonId, ageGroup, ratingEngine: "COLLEY" },
    orderBy: { weekEndingDate: "desc" },
    select: { weekEndingDate: true },
  });

  const ratings = latest
    ? await prisma.teamRatingHistory.findMany({
        where: {
          seasonId,
          ageGroup,
          ratingEngine: "COLLEY",
          weekEndingDate: latest.weekEndingDate,
        },
        include: { team: { include: { club: true } } },
        orderBy: { rank: "asc" },
      })
    : [];

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/power-rankings" className="underline">
          Power Rankings
        </Link>
      </div>
      <h1 className="mb-2 text-2xl font-semibold">
        {season.label} · {ageGroup}u Colley Ratings
      </h1>
      {latest && (
        <p className="mb-6 text-sm text-slate-500">
          As of {latest.weekEndingDate.toLocaleDateString()}
        </p>
      )}

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Rank</th>
            <th className={thClass}>Team</th>
            <th className={thClass}>Club</th>
            <th className={thClass}>Rating</th>
            <th className={thClass}>Comparisons</th>
          </tr>
        </thead>
        <tbody>
          {ratings.map((r) => (
            <tr key={r.id}>
              <td className={tdClass}>{r.rank}</td>
              <td className={tdClass}>
                <Link href={`/admin/teams/${r.team.id}`} className="text-slate-900 underline">
                  {r.team.name}
                </Link>
              </td>
              <td className={tdClass}>{r.team.club?.name ?? ""}</td>
              <td className={tdClass}>{r.rating.toFixed(4)}</td>
              <td className={tdClass}>{r.comparisons}</td>
            </tr>
          ))}
          {ratings.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={5}>
                No ratings yet — run &quot;Recompute ratings&quot; from the Power Rankings page.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
