import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { brand } from "@/lib/brand";
import { tableWrapClass, thClass, tdClass, numThClass, numTdClass, tbodyClass } from "@/lib/publicUi";

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
                  <td className={`${tdClass} font-medium text-slate-900`}>
                    <Link href={`/rankings/teams/${t.id}`} className="after:absolute after:inset-0 hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td className={numTdClass}>{activeTs ? `${activeTs.ageGroup}u` : ""}</td>
                  <td className={numTdClass}>{activeTs?.teamNumber ?? ""}</td>
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
                <td className={tdClass} colSpan={4}>
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
