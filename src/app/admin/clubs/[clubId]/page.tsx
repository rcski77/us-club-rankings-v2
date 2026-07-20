import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import {
  inputClass,
  selectClass,
  primaryButtonClass,
  errorBannerClass,
  successBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";

async function updateClub(clubId: string, formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const regionId = String(formData.get("regionId") ?? "") || null;
  const externalCode = String(formData.get("externalCode") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const state = String(formData.get("state") ?? "").trim() || null;
  const zip = String(formData.get("zip") ?? "").trim() || null;
  const isActive = formData.get("isActive") === "on";

  if (!name) {
    redirect(`/admin/clubs/${clubId}?error=invalid`);
  }

  await prisma.club.update({
    where: { id: clubId },
    data: { name, regionId, externalCode, city, state, zip, isActive },
  });

  revalidatePath(`/admin/clubs/${clubId}`);
  revalidatePath("/admin/clubs");
  redirect(`/admin/clubs/${clubId}?success=1`);
}

export default async function ClubDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { clubId } = await params;
  const { error, success } = await searchParams;

  // Sequential, not Promise.all: the local dev Postgres (via `prisma dev`) doesn't
  // reliably handle concurrent queries from the same connection pool.
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    include: {
      region: true,
      contacts: true,
      teams: {
        include: { seasons: { include: { season: true }, orderBy: { season: { startDate: "desc" } } } },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!club) notFound();
  const regions = await prisma.region.findMany({ orderBy: { code: "asc" } });

  const activeSeason = await prisma.season.findFirst({ where: { isActive: true } });

  const updateClubWithId = updateClub.bind(null, clubId);

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
        <Link href="/admin/clubs" className="underline">
          Clubs
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">{club.name}</h1>

      {error === "invalid" && <p className={errorBannerClass}>Club name is required.</p>}
      {success === "1" && <p className={successBannerClass}>Club saved.</p>}

      <section className="mb-8 max-w-lg">
        <h2 className="mb-2 text-lg font-medium">Edit club</h2>
        <form action={updateClubWithId} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input name="name" defaultValue={club.name} required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Region
            <select name="regionId" className={selectClass} defaultValue={club.regionId ?? ""}>
              <option value="">(none)</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            External code
            <input
              name="externalCode"
              defaultValue={club.externalCode ?? ""}
              placeholder="frogs"
              className={`${inputClass} w-32`}
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-col gap-1 text-sm">
              City
              <input name="city" defaultValue={club.city ?? ""} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              State
              <input
                name="state"
                defaultValue={club.state ?? ""}
                maxLength={2}
                className={`${inputClass} w-16`}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Zip
              <input name="zip" defaultValue={club.zip ?? ""} className={`${inputClass} w-24`} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input name="isActive" type="checkbox" defaultChecked={club.isActive} />
            Active
          </label>
          <button type="submit" className={`${primaryButtonClass} self-start`}>
            Save
          </button>
        </form>
      </section>

      <h2 className="mb-2 text-lg font-medium">Teams</h2>
      {activeSeason && (
        <p className="mb-2 text-xs text-slate-500">
          Age, team #, and code shown are for the active season ({activeSeason.label}).
        </p>
      )}
      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Age</th>
            <th className={thClass}>Team #</th>
            <th className={thClass}>Team code</th>
            <th className={thClass}>Seasons</th>
          </tr>
        </thead>
        <tbody>
          {sortedTeams.map((t) => {
            const activeTs = activeSeason
              ? t.seasons.find((ts) => ts.seasonId === activeSeason.id)
              : undefined;
            return (
              <tr key={t.id}>
                <td className={tdClass}>
                  <Link href={`/admin/teams/${t.id}`} className="text-slate-900 underline">
                    {t.name}
                  </Link>
                </td>
                <td className={tdClass}>{activeTs ? `${activeTs.ageGroup}u` : ""}</td>
                <td className={tdClass}>{activeTs?.teamNumber ?? ""}</td>
                <td className={`${tdClass} font-mono text-xs text-slate-500`}>
                  {activeTs?.externalTeamCode ?? ""}
                </td>
                <td className={tdClass}>
                  {t.seasons.length === 0 && (
                    <span className="text-slate-400">Not enrolled in any season</span>
                  )}
                  <ul className="flex flex-col gap-0.5">
                    {t.seasons.map((ts) => (
                      <li key={ts.id} className="text-xs text-slate-600">
                        {ts.season.label}: {ts.ageGroup}u #{ts.teamNumber}
                        {ts.externalTeamCode && (
                          <span className="font-mono text-slate-400"> ({ts.externalTeamCode})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            );
          })}
          {sortedTeams.length === 0 && (
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
