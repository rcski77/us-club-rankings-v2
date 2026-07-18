import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { tableClass, thClass, tdClass } from "@/lib/ui";

export default async function ClubDetailPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    include: {
      region: true,
      contacts: true,
      teams: {
        include: { season: true },
        orderBy: [{ season: { startDate: "desc" } }, { ageGroup: "desc" }, { name: "asc" }],
      },
    },
  });
  if (!club) notFound();

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/clubs" className="underline">
          Clubs
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-semibold">{club.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {club.region ? `${club.region.code} — ${club.region.name}` : "No region"}
        {club.city && ` · ${[club.city, club.state].filter(Boolean).join(", ")}`}
        {club.externalCode && ` · Code: ${club.externalCode}`}
        {!club.isActive && " · Inactive"}
      </p>

      <h2 className="mb-2 text-lg font-medium">Teams</h2>
      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Code</th>
            <th className={thClass}>Age</th>
            <th className={thClass}>#</th>
            <th className={thClass}>Season</th>
          </tr>
        </thead>
        <tbody>
          {club.teams.map((t) => (
            <tr key={t.id}>
              <td className={tdClass}>{t.name}</td>
              <td className={`${tdClass} font-mono text-xs text-slate-500`}>
                {t.externalTeamCode ?? ""}
              </td>
              <td className={tdClass}>{t.ageGroup}u</td>
              <td className={tdClass}>{t.teamNumber}</td>
              <td className={tdClass}>{t.season.label}</td>
            </tr>
          ))}
          {club.teams.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={5}>
                No teams for this club yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
