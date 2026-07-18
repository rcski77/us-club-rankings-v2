import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import {
  inputClass,
  selectClass,
  primaryButtonClass,
  errorBannerClass,
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
}

export default async function ClubDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { clubId } = await params;
  const { error } = await searchParams;

  const [club, regions] = await Promise.all([
    prisma.club.findUnique({
      where: { id: clubId },
      include: {
        region: true,
        contacts: true,
        teams: {
          include: { season: true },
          orderBy: [{ season: { startDate: "desc" } }, { ageGroup: "desc" }, { name: "asc" }],
        },
      },
    }),
    prisma.region.findMany({ orderBy: { code: "asc" } }),
  ]);
  if (!club) notFound();

  const updateClubWithId = updateClub.bind(null, clubId);

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/clubs" className="underline">
          Clubs
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">{club.name}</h1>

      {error === "invalid" && <p className={errorBannerClass}>Club name is required.</p>}

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
              <td className={tdClass}>
                <Link href={`/admin/teams/${t.id}`} className="text-slate-900 underline">
                  {t.name}
                </Link>
              </td>
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
