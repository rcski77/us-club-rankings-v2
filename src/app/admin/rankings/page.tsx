import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { selectClass, primaryButtonClass } from "@/lib/ui";

async function goToRanking(formData: FormData) {
  "use server";
  const seasonId = String(formData.get("seasonId") ?? "");
  const ageGroup = String(formData.get("ageGroup") ?? "");
  if (!seasonId || !ageGroup) redirect("/admin/rankings");
  redirect(`/admin/rankings/${seasonId}/${ageGroup}`);
}

const AGE_GROUPS = [12, 13, 14, 15, 16, 17, 18];

export default async function RankingsIndexPage() {
  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Rankings</h1>

      {seasons.length === 0 ? (
        <p className="text-sm text-slate-500">Create a season first (Admin → Seasons).</p>
      ) : (
        <form action={goToRanking} className="flex items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Season
            <select name="seasonId" className={selectClass} defaultValue={activeSeason?.id}>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Age group
            <select name="ageGroup" className={selectClass} defaultValue="14">
              {AGE_GROUPS.map((a) => (
                <option key={a} value={a}>
                  {a}u
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={primaryButtonClass}>
            View ranking
          </button>
        </form>
      )}
    </div>
  );
}
