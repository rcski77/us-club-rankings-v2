import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Fragment } from "react";
import { primaryButtonClass, successBannerClass, tableClass, thClass, tdClass, stripedTbodyClass } from "@/lib/ui";
import { ordinalSuffix } from "@/lib/rating/powerRankings";
import { computeClubRankingForSeason } from "@/lib/ranking/computeClubRanking";
import { AGE_GROUPS } from "@/lib/ranking/clubRanking";
import { SeasonFilterSelect } from "../team-rankings/SeasonFilterSelect";
import { SubmitButton } from "@/components/SubmitButton";

async function recomputeClubRankings(formData: FormData) {
  "use server";
  const seasonId = String(formData.get("seasonId") ?? "");
  if (!seasonId) redirect("/admin/club-rankings");

  await computeClubRankingForSeason(seasonId);
  revalidatePath("/admin/club-rankings");
  redirect(`/admin/club-rankings?${new URLSearchParams({ season: seasonId, recomputed: "1" })}`);
}

export default async function ClubRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; recomputed?: string }>;
}) {
  const { season: seasonParam, recomputed } = await searchParams;

  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const season = seasons.find((s) => s.id === seasonParam) ?? activeSeason;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Club Rankings</h1>

      {recomputed === "1" && <p className={successBannerClass}>Club rankings recomputed.</p>}

      {seasons.length === 0 || !season ? (
        <p className="text-sm text-slate-500">Create a season first (Admin → Seasons).</p>
      ) : (
        <>
          <div className="mb-6 flex items-end gap-3">
            <form method="get" className="flex items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Season
                <SeasonFilterSelect seasons={seasons} defaultValue={season.id} />
              </label>
            </form>

            <form action={recomputeClubRankings}>
              <input type="hidden" name="seasonId" value={season.id} />
              <SubmitButton className={primaryButtonClass} pendingText="Recomputing…">
                Recompute club rankings
              </SubmitButton>
            </form>
            <p className="pb-2 text-xs text-slate-500">
              Rolls up the season&apos;s already-computed Team Rankings into a per-club score. Run
              Team Rankings&apos; own recompute first if those look stale.
            </p>
          </div>

          <ClubRankingTable seasonId={season.id} />
        </>
      )}
    </div>
  );
}

async function ClubRankingTable({ seasonId }: { seasonId: string }) {
  const results = await prisma.clubRankingResult.findMany({
    where: { seasonId },
    include: {
      club: true,
      contributions: { include: { team: true }, orderBy: { ageGroup: "asc" } },
    },
    orderBy: { rank: "asc" },
  });

  const qualified = results.filter((r) => r.isQualified);
  const underQualified = results.filter((r) => !r.isQualified);

  const groups: { label: string; rows: typeof results }[] = [
    { label: "Qualified (3+ age groups in that age group's top 100)", rows: qualified },
    { label: "Under-qualified (still ranked, sorted after qualified clubs)", rows: underQualified },
  ];

  return (
    <table className={tableClass}>
      <thead>
        <tr>
          <th className={thClass}>Rank</th>
          <th className={thClass}>Club</th>
          <th className={thClass}>Total Points</th>
          {AGE_GROUPS.map((ag) => (
            <th key={ag} className={thClass}>
              {ag}U
            </th>
          ))}
        </tr>
      </thead>
      <tbody className={stripedTbodyClass}>
        {groups.map(
          (group) =>
            group.rows.length > 0 && (
              <Fragment key={group.label}>
                <tr>
                  <td colSpan={3 + AGE_GROUPS.length} className={`${tdClass} bg-slate-100 font-medium`}>
                    {group.label}
                  </td>
                </tr>
                {group.rows.map((r) => {
                  const byAgeGroup = new Map(r.contributions.map((c) => [c.ageGroup, c]));
                  return (
                    <tr key={r.id}>
                      <td className={tdClass}>{r.rank}</td>
                      <td className={tdClass}>
                        <Link
                          href={`/admin/clubs/${r.club.id}`}
                          prefetch={false}
                          className="text-slate-900 underline"
                        >
                          {r.club.name}
                        </Link>
                      </td>
                      <td className={tdClass}>{r.totalPoints.toFixed(1)}</td>
                      {AGE_GROUPS.map((ag) => {
                        const c = byAgeGroup.get(ag);
                        if (!c || !c.team) {
                          return (
                            <td key={ag} className={`${tdClass} text-slate-400`}>
                              —
                            </td>
                          );
                        }
                        return (
                          <td key={ag} className={`${tdClass} ${c.countedInBest5 ? "" : "text-slate-400 line-through"}`}>
                            <Link href={`/admin/teams/${c.team.id}`} prefetch={false} className="underline">
                              {c.team.name}
                            </Link>{" "}
                            ({c.rank}
                            {ordinalSuffix(c.rank ?? 0)})
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ),
        )}
        {results.length === 0 && (
          <tr>
            <td className={tdClass} colSpan={3 + AGE_GROUPS.length}>
              No club rankings yet — click &quot;Recompute club rankings&quot; above.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
