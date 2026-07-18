import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { tableClass, thClass, tdClass, inputClass, selectClass, primaryButtonClass, errorBannerClass } from "@/lib/ui";

async function updateTeam(teamId: string, formData: FormData) {
  "use server";

  const clubId = String(formData.get("clubId") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();
  const ageGroup = Number(formData.get("ageGroup"));
  const teamNumber = Number(formData.get("teamNumber") ?? 1);
  const externalTeamCode = String(formData.get("externalTeamCode") ?? "").trim() || null;

  if (!name || !ageGroup || !teamNumber) {
    redirect(`/admin/teams/${teamId}?error=invalid`);
  }

  await prisma.team.update({
    where: { id: teamId },
    data: { clubId, name, ageGroup, teamNumber, externalTeamCode },
  });

  revalidatePath(`/admin/teams/${teamId}`);
  revalidatePath("/admin/teams");
}

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { teamId } = await params;
  const { error } = await searchParams;

  const [team, clubs] = await Promise.all([
    prisma.team.findUnique({
      where: { id: teamId },
      include: {
        club: true,
        season: true,
        finishes: { include: { division: { include: { event: true } } }, orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.club.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!team) notFound();

  const updateTeamWithId = updateTeam.bind(null, teamId);

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/teams" className="underline">
          Teams
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">{team.name}</h1>

      {error === "invalid" && (
        <p className={errorBannerClass}>Name, age group, and team number are required.</p>
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
          <div className="flex gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Age group
              <input
                name="ageGroup"
                type="number"
                min={10}
                max={18}
                defaultValue={team.ageGroup}
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
                defaultValue={team.teamNumber}
                required
                className={`${inputClass} w-20`}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Code
            <input
              name="externalTeamCode"
              defaultValue={team.externalTeamCode ?? ""}
              placeholder="g14frogs1nt"
              className={`${inputClass} w-40`}
            />
          </label>
          <p className="text-xs text-slate-500">
            Season: {team.season.label} (fixed — create a new team to move seasons)
          </p>
          <button type="submit" className={`${primaryButtonClass} self-start`}>
            Save
          </button>
        </form>
      </section>

      <h2 className="mb-2 text-lg font-medium">Finishes</h2>
      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Event</th>
            <th className={thClass}>Division</th>
            <th className={thClass}>Rank</th>
            <th className={thClass}>Points</th>
          </tr>
        </thead>
        <tbody>
          {team.finishes.map((f) => (
            <tr key={f.id}>
              <td className={tdClass}>{f.division.event.name}</td>
              <td className={tdClass}>{f.division.name}</td>
              <td className={tdClass}>{f.rank}</td>
              <td className={tdClass}>{f.points ?? ""}</td>
            </tr>
          ))}
          {team.finishes.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={4}>
                No finishes yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
