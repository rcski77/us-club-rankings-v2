import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BUCKET_THRESHOLDS } from "@/lib/rating/fieldStrength";
import { computeDivisionWeightsForPartition } from "@/lib/rating/computeMatchDivisionWeights";
import { computeDivisionScoringSuggestion } from "@/lib/rating/computeDivisionScoringSuggestion";
import { computeAnalysisForSeasonInWorker } from "@/lib/rating/computeAnalysisForSeasonInWorker";
import type { ScoreBand } from "@/lib/rating/suggestPointTemplate";
import {
  tableClass,
  thClass,
  tdClass,
  primaryButtonClass,
  secondaryButtonClass,
  successBannerClass,
  stripedTbodyClass,
  scoringStatusBadgeClass,
  scoreBandBadgeClass,
} from "@/lib/ui";
import { SubmitButton } from "@/components/SubmitButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ seasonId: string; ageGroup: string }>;
}): Promise<Metadata> {
  const { seasonId, ageGroup } = await params;
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { label: true } });
  return { title: season ? `U${ageGroup} Analysis — ${season.label}` : "Analysis" };
}

async function runAnalysisForAll(seasonId: string, ageGroup: number) {
  "use server";

  const divisions = await prisma.division.findMany({
    where: { ageGroup, event: { seasonId } },
    select: { id: true, scoringStatus: true },
  });

  for (const division of divisions) {
    // CONFIRMED divisions get their stats refreshed (as new match data lands) without
    // reopening finish/band editing -- see computeDivisionScoringSuggestion's
    // preserveStatus doc comment.
    await computeDivisionScoringSuggestion(division.id, {
      preserveStatus: division.scoringStatus === "CONFIRMED",
    });
  }

  redirect(`/admin/analysis/${seasonId}/${ageGroup}`);
}

/**
 * Runs analysis across every age group in the season at once -- staff previously had
 * to visit each age group's page and click "Run analysis for all divisions"
 * separately. Fire-and-forget via computeAnalysisForSeasonInWorker (not awaited here)
 * for the same reason team-rankings' "Recompute ratings" and club-rankings' recompute
 * buttons are: a whole-season loop over every division can run long enough to risk
 * Cloudflare's ~100s proxy timeout on the homelab host. Redirects immediately with an
 * "started," not "complete," banner -- see recomputeAll in team-rankings/page.tsx for
 * the same pattern and its own comment on why that's the honest thing to show.
 */
async function runAnalysisForSeason(seasonId: string, ageGroup: number) {
  "use server";

  computeAnalysisForSeasonInWorker(seasonId).catch((err) => {
    console.error(`Background season-wide analysis run failed for season ${seasonId}:`, err);
  });

  redirect(`/admin/analysis/${seasonId}/${ageGroup}?analysisStarted=1`);
}

/**
 * The Analysis view (docs/plan.md §2/§5) -- one row per Division in this
 * (season, ageGroup), showing its latest DivisionScoringSnapshot's FSS/percentile/
 * score band/bucket breakdown side by side. Doubles as the suggestion algorithm's
 * justification UI: staff can sanity-check one division's suggestion against every
 * other division's in the same age group, the way the legacy Analysis screen let them
 * eyeball Top5/10/25/.../250 counts across events.
 *
 * "Rating Weight" is a separate, live-computed column, not part of the persisted
 * DivisionScoringSnapshot: computeDivisionWeightsForPartition() (see
 * computeMatchDivisionWeights.ts) is the same Colley-only rank transform both Elo and
 * Massey recompute use to weight a division's matches (Elo as a K-factor multiplier,
 * Massey by scaling that match's matrix contribution -- see massey.ts's solveMassey),
 * exposed here so staff can see how a division will actually affect either engine
 * before/without running a recompute. Deliberately distinct from Band/Pctl above it,
 * which is sometimes Elo/DCI-based depending on the division's own match coverage --
 * the two numbers answer different questions ("what point curve fits this field" vs.
 * "how much should a result here move Elo/Massey") and won't generally match.
 */
const AGE_GROUPS = [12, 13, 14, 15, 16, 17, 18];

type SortKey = "fss" | "elitePresence" | "percentile" | "eloWeight" | "maxPoints" | `bucket:${number}`;

function sortLink(seasonId: string, ageGroup: number, key: SortKey, activeSort?: string, activeDir?: string) {
  // First click on a column defaults to highest-first (desc); a second click toggles to asc.
  const nextDir = activeSort === key && activeDir === "desc" ? "asc" : "desc";
  return `/admin/analysis/${seasonId}/${ageGroup}?sort=${encodeURIComponent(key)}&dir=${nextDir}`;
}

function sortIndicator(key: SortKey, activeSort?: string, activeDir?: string) {
  if (activeSort !== key) return null;
  return activeDir === "desc" ? " ▼" : " ▲";
}

export default async function AnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ seasonId: string; ageGroup: string }>;
  searchParams: Promise<{ sort?: string; dir?: string; analysisStarted?: string }>;
}) {
  const { seasonId, ageGroup: ageGroupParam } = await params;
  const ageGroup = Number(ageGroupParam);
  const { sort, dir, analysisStarted } = await searchParams;

  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season || !ageGroup) notFound();

  const divisions = await prisma.division.findMany({
    where: { ageGroup, event: { seasonId } },
    include: {
      event: true,
      pointBands: true,
      scoringSnapshots: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { suggestedTemplate: true },
      },
    },
    orderBy: [{ event: { startDate: "asc" } }, { name: "asc" }],
  });

  const eloWeights = await computeDivisionWeightsForPartition(seasonId, ageGroup);

  // Once confirmed, a division's actual max points come from its own frozen
  // DivisionPointBand copy (prisma/CLAUDE.md's frozen-copy pattern), not the source
  // PointTemplate -- that can be edited later without touching what was already
  // awarded. Before confirming, there's nothing awarded yet, so fall back to showing
  // the suggested template's ceiling as a preview.
  function maxPointsForDivision(division: (typeof divisions)[number]): number | null {
    if (division.pointBands.length > 0) {
      return Math.max(...division.pointBands.map((b) => b.points));
    }
    return division.scoringSnapshots[0]?.suggestedTemplate?.maxPoints ?? null;
  }

  // Sortable metrics live on the snapshot/eloWeights, not the Division row itself, so
  // sorting happens here in memory rather than via a Prisma orderBy -- the default
  // findMany above already fetched everything sortLink's columns need.
  function sortValue(division: (typeof divisions)[number], key: SortKey): number | null {
    const snapshot = division.scoringSnapshots[0];
    if (key === "fss") return snapshot?.fss ?? null;
    if (key === "elitePresence") return snapshot?.elitePresence ?? null;
    if (key === "percentile") return snapshot?.percentile ?? null;
    if (key === "eloWeight") return eloWeights.get(division.id) ?? null;
    if (key === "maxPoints") return maxPointsForDivision(division);
    const bucketCounts = (snapshot?.bucketCounts as Record<string, number> | undefined) ?? {};
    const threshold = key.slice("bucket:".length);
    return bucketCounts[threshold] ?? null;
  }

  const sortedDivisions = [...divisions];
  if (sort) {
    const sortKey = sort as SortKey;
    const sign = dir === "desc" ? -1 : 1;
    sortedDivisions.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      // Nulls (no snapshot yet) always sort last, regardless of direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * sign;
    });
  }

  const runAnalysisForAllWithParams = runAnalysisForAll.bind(null, seasonId, ageGroup);
  const runAnalysisForSeasonWithParams = runAnalysisForSeason.bind(null, seasonId, ageGroup);

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Analysis", href: "/admin/analysis" },
          { label: `${season.label} · ${ageGroup}u` },
        ]}
      />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {season.label} · {ageGroup}u Analysis
        </h1>
        <div className="flex items-center gap-3">
          <form action={runAnalysisForAllWithParams}>
            <SubmitButton className={primaryButtonClass} pendingText="Running…">
              Run analysis for all divisions
            </SubmitButton>
          </form>
          <form action={runAnalysisForSeasonWithParams}>
            <SubmitButton className={secondaryButtonClass} pendingText="Starting…">
              Run analysis for all age groups
            </SubmitButton>
          </form>
        </div>
      </div>

      <div className="mb-6 flex gap-1 border-b">
        {AGE_GROUPS.map((a) => (
          <Link
            key={a}
            href={`/admin/analysis/${seasonId}/${a}`}
            prefetch={false}
            className={
              a === ageGroup
                ? "border-b-2 border-slate-900 px-3 py-2 text-sm font-medium text-slate-900"
                : "border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
            }
          >
            {a}u
          </Link>
        ))}
      </div>

      {analysisStarted === "1" && (
        <p className={successBannerClass}>
          Analysis started for every age group in {season.label} — it runs in the
          background and can take a minute or two. Reload this page in a bit to see
          fresh results.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>Event</th>
              <th className={thClass}>Division</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Teams</th>
              <th className={thClass}>Engine</th>
              <th className={thClass}>
                <Link href={sortLink(seasonId, ageGroup, "fss", sort, dir)} className="hover:underline">
                  FSS{sortIndicator("fss", sort, dir)}
                </Link>
              </th>
              <th className={thClass}>
                <Link
                  href={sortLink(seasonId, ageGroup, "elitePresence", sort, dir)}
                  className="hover:underline"
                >
                  Elite %{sortIndicator("elitePresence", sort, dir)}
                </Link>
              </th>
              <th className={thClass}>
                <Link href={sortLink(seasonId, ageGroup, "percentile", sort, dir)} className="hover:underline">
                  Pctl{sortIndicator("percentile", sort, dir)}
                </Link>
              </th>
              <th className={thClass}>Band</th>
              <th className={thClass}>
                <Link href={sortLink(seasonId, ageGroup, "eloWeight", sort, dir)} className="hover:underline">
                  Rating Weight{sortIndicator("eloWeight", sort, dir)}
                </Link>
              </th>
              {BUCKET_THRESHOLDS.map((t) => (
                <th key={t} className={thClass}>
                  <Link
                    href={sortLink(seasonId, ageGroup, `bucket:${t}`, sort, dir)}
                    className="hover:underline"
                  >
                    Top {t}
                    {sortIndicator(`bucket:${t}`, sort, dir)}
                  </Link>
                </th>
              ))}
              <th className={thClass}>
                <Link href={sortLink(seasonId, ageGroup, "maxPoints", sort, dir)} className="hover:underline">
                  Max Points{sortIndicator("maxPoints", sort, dir)}
                </Link>
              </th>
            </tr>
          </thead>
          <tbody className={stripedTbodyClass}>
            {sortedDivisions.map((division) => {
              const snapshot = division.scoringSnapshots[0];
              const bucketCounts =
                (snapshot?.bucketCounts as Record<string, number> | undefined) ?? {};
              return (
                <tr key={division.id}>
                  <td className={tdClass}>{division.event.name}</td>
                  <td className={tdClass}>
                    <Link
                      href={`/admin/events/${division.eventId}/divisions/${division.id}/scoring`}
                      prefetch={false}
                      className="underline"
                    >
                      {division.name}
                    </Link>
                  </td>
                  <td className={tdClass}>
                    <span className={scoringStatusBadgeClass(division.scoringStatus)}>
                      {division.scoringStatus}
                    </span>
                  </td>
                  <td className={tdClass}>
                    {snapshot ? `${snapshot.teamCount} / ${snapshot.ratedTeamCount}` : "—"}
                  </td>
                  <td className={tdClass}>{snapshot?.ratingEngineUsed ?? "—"}</td>
                  <td className={tdClass}>
                    {snapshot?.fss !== null && snapshot?.fss !== undefined
                      ? snapshot.ratingEngineUsed === "ELO"
                        ? snapshot.fss.toFixed(0)
                        : snapshot.fss.toFixed(3)
                      : "—"}
                  </td>
                  <td className={tdClass}>
                    {snapshot?.elitePresence !== null && snapshot?.elitePresence !== undefined
                      ? `${snapshot.elitePresence.toFixed(0)}%`
                      : "—"}
                  </td>
                  <td className={tdClass}>
                    {snapshot?.percentile !== null && snapshot?.percentile !== undefined
                      ? `${snapshot.percentile.toFixed(0)}th`
                      : "—"}
                  </td>
                  <td className={tdClass}>
                    {snapshot?.scoreBand ? (
                      <span className={scoreBandBadgeClass(snapshot.scoreBand as ScoreBand)}>{snapshot.scoreBand}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={tdClass}>{eloWeights.get(division.id)?.toFixed(3) ?? "—"}</td>
                  {BUCKET_THRESHOLDS.map((t) => (
                    <td key={t} className={tdClass}>
                      {bucketCounts[String(t)] ?? "—"}
                    </td>
                  ))}
                  <td className={tdClass}>
                    {(() => {
                      const maxPoints = maxPointsForDivision(division);
                      if (maxPoints === null) return "—";
                      // Green when it's the division's actual awarded max (from its
                      // frozen DivisionPointBand copy); amber when it's still just the
                      // suggested template's ceiling, not yet confirmed/awarded.
                      const isAwarded = division.pointBands.length > 0;
                      return (
                        <span className={scoringStatusBadgeClass(isAwarded ? "CONFIRMED" : "SUGGESTED")}>
                          {maxPoints}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
            {divisions.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={11 + BUCKET_THRESHOLDS.length}>
                  No divisions found for this season/age group.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
