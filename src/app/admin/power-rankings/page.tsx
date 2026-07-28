import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { selectClass, primaryButtonClass, secondaryButtonClass, successBannerClass } from "@/lib/ui";
import { computeColleyRatingsForSeason } from "@/lib/rating/computeColleyRatings";
import { computeEloRatingsForSeason } from "@/lib/rating/computeEloRatings";

async function goToRating(formData: FormData) {
  "use server";
  const seasonId = String(formData.get("seasonId") ?? "");
  const ageGroup = String(formData.get("ageGroup") ?? "");
  if (!seasonId || !ageGroup) redirect("/admin/power-rankings");
  redirect(`/admin/power-rankings/${seasonId}/${ageGroup}`);
}

async function recomputeColley(formData: FormData) {
  "use server";
  const seasonId = String(formData.get("seasonId") ?? "");
  if (!seasonId) redirect("/admin/power-rankings");
  await computeColleyRatingsForSeason(seasonId);
  redirect(`/admin/power-rankings?recomputed=colley`);
}

async function recomputeElo(formData: FormData) {
  "use server";
  const seasonId = String(formData.get("seasonId") ?? "");
  if (!seasonId) redirect("/admin/power-rankings");
  await computeEloRatingsForSeason(seasonId);
  redirect(`/admin/power-rankings?recomputed=elo`);
}

const AGE_GROUPS = [12, 13, 14, 15, 16, 17, 18];

export default async function PowerRankingsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ recomputed?: string }>;
}) {
  const { recomputed } = await searchParams;
  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Power Rankings</h1>

      {recomputed === "colley" && (
        <p className={successBannerClass}>Colley ratings recomputed for every age group in this season.</p>
      )}
      {recomputed === "elo" && (
        <p className={successBannerClass}>
          Elo ratings recomputed for every age group in this season, from imported Match results.
        </p>
      )}

      {seasons.length === 0 ? (
        <p className="text-sm text-slate-500">Create a season first (Admin → Seasons).</p>
      ) : (
        <div className="flex flex-col gap-6">
          <form action={goToRating} className="flex items-end gap-3">
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
              View ratings
            </button>
          </form>

          <form action={recomputeColley} className="flex items-end gap-3 border-t pt-4">
            <label className="flex flex-col gap-1 text-sm">
              Recompute season
              <select name="seasonId" className={selectClass} defaultValue={activeSeason?.id}>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={secondaryButtonClass}>
              Recompute Colley ratings
            </button>
            <p className="text-xs text-slate-500">
              Runs the Colley solve for every age group with enrolled teams, from all CONFIRMED
              finishes to date.
            </p>
          </form>

          <form action={recomputeElo} className="flex items-end gap-3 border-t pt-4">
            <label className="flex flex-col gap-1 text-sm">
              Recompute season
              <select name="seasonId" className={selectClass} defaultValue={activeSeason?.id}>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={secondaryButtonClass}>
              Recompute Elo ratings
            </button>
            <p className="text-xs text-slate-500">
              Replays every imported Match result chronologically, for every age group with
              enrolled teams. Divisions with no imported matches contribute nothing yet.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
