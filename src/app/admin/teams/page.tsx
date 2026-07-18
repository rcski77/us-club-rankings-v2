import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  inputClass,
  selectClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";

async function createTeam(formData: FormData) {
  "use server";

  const clubId = String(formData.get("clubId") ?? "") || null;
  const seasonId = String(formData.get("seasonId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const ageGroup = Number(formData.get("ageGroup"));
  const teamNumber = Number(formData.get("teamNumber") ?? 1);
  const externalTeamCode = String(formData.get("externalTeamCode") ?? "").trim() || null;

  if (!seasonId || !name || !ageGroup || !teamNumber) {
    redirect(`/admin/teams?seasonId=${seasonId}&error=invalid`);
  }

  await prisma.team.create({
    data: {
      clubId,
      name,
      seasons: { create: { seasonId, ageGroup, teamNumber, externalTeamCode } },
    },
  });

  redirect(`/admin/teams?seasonId=${seasonId}`);
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; seasonId?: string }>;
}) {
  const { error, seasonId: seasonIdParam } = await searchParams;
  const [clubs, seasons] = await Promise.all([
    prisma.club.findMany({ orderBy: { name: "asc" } }),
    prisma.season.findMany({ orderBy: { startDate: "desc" } }),
  ]);
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const selectedSeasonId = seasonIdParam || activeSeason?.id;

  const teams = selectedSeasonId
    ? await prisma.team.findMany({
        where: { seasons: { some: { seasonId: selectedSeasonId } } },
        include: { club: true, seasons: { where: { seasonId: selectedSeasonId } } },
        orderBy: { name: "asc" },
        take: 200,
      })
    : [];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Teams</h1>

      {error === "invalid" && (
        <p className={errorBannerClass}>Season, name, age group, and team number are required.</p>
      )}
      {seasons.length === 0 && (
        <p className={errorBannerClass}>
          Create a season first (Admin → Seasons) before adding teams.
        </p>
      )}

      {seasons.length > 0 && (
        <form action="/admin/teams" className="mb-4 flex items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Season
            <select name="seasonId" className={selectClass} defaultValue={selectedSeasonId}>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={secondaryButtonClass}>
            Filter
          </button>
        </form>
      )}

      <table className={`${tableClass} mb-8`}>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Code</th>
            <th className={thClass}>Club</th>
            <th className={thClass}>Age</th>
            <th className={thClass}>#</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => (
            <tr key={t.id}>
              <td className={tdClass}>
                <Link href={`/admin/teams/${t.id}`} className="text-slate-900 underline">
                  {t.name}
                </Link>
              </td>
              <td className={`${tdClass} font-mono text-xs text-slate-500`}>
                {t.seasons[0]?.externalTeamCode ?? ""}
              </td>
              <td className={tdClass}>
                {t.club ? t.club.name : <span className="text-amber-600">Unlinked</span>}
              </td>
              <td className={tdClass}>{t.seasons[0]?.ageGroup}u</td>
              <td className={tdClass}>{t.seasons[0]?.teamNumber}</td>
            </tr>
          ))}
          {teams.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={5}>
                No teams for this season yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {seasons.length > 0 && (
        <>
          <h2 className="mb-2 text-lg font-medium">New team</h2>
          <p className="mb-2 text-xs text-slate-500">
            Creates the team and enrolls it in the selected season. A team already in
            the system can also be added to additional seasons from its detail page.
          </p>
          <form action={createTeam} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input name="name" placeholder="MADFROG 14'S N GREEN" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Club
              <select name="clubId" className={selectClass} defaultValue="">
                <option value="">(unlinked)</option>
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
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
                type="number"
                min={1}
                defaultValue={1}
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
            <label className="flex flex-col gap-1 text-sm">
              Season
              <select
                name="seasonId"
                className={selectClass}
                defaultValue={selectedSeasonId}
              >
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={primaryButtonClass}>
              Create team
            </button>
          </form>
        </>
      )}
    </div>
  );
}
