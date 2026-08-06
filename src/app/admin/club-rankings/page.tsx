import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Fragment } from "react";
import { primaryButtonClass, successBannerClass, tableClass, thClass, tdClass, stripedTbodyClass } from "@/lib/ui";
import { ordinalSuffix } from "@/lib/rating/powerRankings";
import { computeClubRankingInWorker } from "@/lib/ranking/computeClubRankingInWorker";
import { AGE_GROUPS } from "@/lib/ranking/clubRanking";
import type { ClubRankingSource } from "@/generated/prisma/enums";
import { SeasonFilterSelect } from "../team-rankings/SeasonFilterSelect";
import { SubmitButton } from "@/components/SubmitButton";

const SOURCES = [
  { value: "NPS", label: "NPS" },
  { value: "COMBINED", label: "Combined" },
] as const;

/**
 * Deliberately does NOT await computeClubRankingInWorker() -- the COMBINED source in
 * particular re-derives Power Rankings' Colley/Elo/Massey data once per age group on
 * top of the NPS query, which on a season with a full year of real data ran past
 * Cloudflare's ~100s proxy timeout on the homelab docker host when awaited inline
 * (NPS alone stayed fast enough not to show the problem). Same fire-and-forget +
 * "started" (not "recomputed") redirect as team-rankings' own recomputeAll -- see
 * docs/plan.md's "Team rankings recompute performance" note for why waiting on the
 * worker process doesn't help: the triggering request is exposed to the fronting
 * proxy's timeout for as long as it stays open, regardless of which process does the
 * actual work.
 */
async function recomputeClubRankings(formData: FormData) {
  "use server";
  const seasonId = String(formData.get("seasonId") ?? "");
  const source = String(formData.get("source") ?? "NPS") as ClubRankingSource;
  if (!seasonId) redirect("/admin/club-rankings");

  computeClubRankingInWorker(seasonId, source).catch((err) => {
    console.error(`Background club-ranking recompute failed for season ${seasonId} (${source}):`, err);
  });

  redirect(
    `/admin/club-rankings?${new URLSearchParams({ season: seasonId, source, recomputeStarted: "1" })}`,
  );
}

export default async function ClubRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; source?: string; recomputeStarted?: string }>;
}) {
  const { season: seasonParam, source: sourceParam, recomputeStarted } = await searchParams;

  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const season = seasons.find((s) => s.id === seasonParam) ?? activeSeason;
  const source: ClubRankingSource = sourceParam === "COMBINED" ? "COMBINED" : "NPS";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Club Rankings</h1>

      {recomputeStarted === "1" && (
        <p className={successBannerClass}>
          Recompute started — it runs in the background and can take a minute or two on a full
          season. Reload in a bit to see fresh results.
        </p>
      )}

      {seasons.length === 0 || !season ? (
        <p className="text-sm text-slate-500">Create a season first (Admin → Seasons).</p>
      ) : (
        <>
          <div className="mb-6 flex items-end gap-3">
            <form method="get" className="flex items-end gap-3">
              <input type="hidden" name="source" value={source} />
              <label className="flex flex-col gap-1 text-sm">
                Season
                <SeasonFilterSelect seasons={seasons} defaultValue={season.id} />
              </label>
            </form>

            <form action={recomputeClubRankings}>
              <input type="hidden" name="seasonId" value={season.id} />
              <input type="hidden" name="source" value={source} />
              <SubmitButton className={primaryButtonClass} pendingText="Recomputing…">
                Recompute {source === "NPS" ? "NPS" : "Combined"} club rankings
              </SubmitButton>
            </form>
            <p className="pb-2 text-xs text-slate-500">
              {source === "NPS"
                ? "Rolls up the season's NPS Rankings (points-based finishes) into a per-club score."
                : "Rolls up the season's Combined Rankings (50% NPS rank + 50% Power Avg Rank) into a per-club score."}{" "}
              Run Team Rankings&apos; own recompute first if those look stale.
            </p>
          </div>

          <div className="mb-6 flex gap-1 border-b">
            {SOURCES.map((s) => (
              <Link
                key={s.value}
                href={`/admin/club-rankings?${new URLSearchParams({ season: season.id, source: s.value })}`}
                prefetch={false}
                className={
                  s.value === source
                    ? "border-b-2 border-slate-900 px-3 py-2 text-sm font-medium text-slate-900"
                    : "border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
                }
              >
                {s.label}
              </Link>
            ))}
            {/* Not a season+source tab like NPS/Combined above -- 5-Year Aggregate is
                a different route entirely (year-window-scoped, not season-scoped, see
                src/app/admin/club-rankings/five-year/page.tsx), so it's never "active"
                here; styled as a plain (never-underlined-active) tab so it reads as a
                sibling view of Club Rankings rather than a stray link. */}
            <Link
              href="/admin/club-rankings/five-year"
              prefetch={false}
              className="border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
            >
              5-Year Aggregate →
            </Link>
          </div>

          <ClubRankingTable seasonId={season.id} source={source} />
        </>
      )}
    </div>
  );
}

async function ClubRankingTable({ seasonId, source }: { seasonId: string; source: ClubRankingSource }) {
  const results = await prisma.clubRankingResult.findMany({
    where: { seasonId, source },
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

  // Every row in one (season, source) recompute shares the same computedAt -- see
  // computeClubRankingForSeason -- so the first row's timestamp represents the whole
  // batch, same convention as Power Rankings' own "as of" line (team-rankings/page.tsx).
  const computedAt = results[0]?.computedAt;

  return (
    <>
      {computedAt && (
        <p className="mb-4 text-sm text-slate-500">
          {source === "NPS" ? "NPS" : "Combined"} club rankings as of{" "}
          {computedAt.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}
        </p>
      )}

      <table className={tableClass}>
      <thead>
        <tr>
          <th className={thClass}>Rank</th>
          <th className={thClass}>Club</th>
          <th className={thClass}>Total Points</th>
          <th className={thClass}>Top-100 Age Groups</th>
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
                  <td colSpan={4 + AGE_GROUPS.length} className={`${tdClass} bg-slate-100 font-medium`}>
                    {group.label}
                  </td>
                </tr>
                {group.rows.map((r) => {
                  const byAgeGroup = new Map(r.contributions.map((c) => [c.ageGroup, c]));
                  // Not persisted directly on ClubRankingResult (only the isQualified
                  // boolean is) -- derived here from each age group's own rank, same
                  // top-100 threshold rankClubs() used to order the under-qualified
                  // tier by this count.
                  const qualifyingAgeGroupCount = r.contributions.filter(
                    (c) => c.rank !== null && c.rank <= 100,
                  ).length;
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
                      <td className={tdClass}>{qualifyingAgeGroupCount}</td>
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
            <td className={tdClass} colSpan={4 + AGE_GROUPS.length}>
              No club rankings yet for this view — click &quot;Recompute&quot; above.
            </td>
          </tr>
        )}
      </tbody>
    </table>
    </>
  );
}
