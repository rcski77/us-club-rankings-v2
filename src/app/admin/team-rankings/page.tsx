import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  selectClass,
  primaryButtonClass,
  successBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";
import { recomputeRatingsInWorker } from "@/lib/rating/recomputeRatingsInWorker";
import {
  ordinalSuffix,
  sortRows,
  getLatestPowerRatings,
  buildPowerRows,
  averagePowerRank,
  assignRanksWithTies,
  type PowerRatingsData,
  type PowerRow,
} from "@/lib/rating/powerRankings";
import { SeasonFilterSelect } from "./SeasonFilterSelect";
import { SubmitButton } from "@/components/SubmitButton";

const AGE_GROUPS = [12, 13, 14, 15, 16, 17, 18];
const VIEWS = [
  { value: "nps", label: "NPS Rankings" },
  { value: "power", label: "Power Rankings" },
  { value: "combine", label: "Combined Rankings" },
] as const;
type View = (typeof VIEWS)[number]["value"];
type SortDir = "asc" | "desc";

/** Kicks off Colley, Elo, and Massey ratings for the whole season in one action -- the
 * three engines used to have separate buttons, but staff always want all three current
 * together, not one at a time.
 *
 * Deliberately does NOT await recomputeRatingsInWorker() -- a full-season recompute can
 * run right up against (and occasionally past) Cloudflare's ~100s proxy timeout on the
 * homelab docker host, which isn't something the app can raise. The underlying worker
 * process finishes and writes its results regardless of whether this request waits for
 * it, so waiting only bought a false-alarm error page for something that actually
 * succeeded. Redirecting immediately with a "started" (not "complete") message and
 * relying on TeamRatingHistory.createdAt for freshness (see the "as of" display below)
 * is honest about what this button can actually promise synchronously.
 */
async function recomputeAll(formData: FormData) {
  "use server";
  const seasonId = String(formData.get("seasonId") ?? "");
  const view = String(formData.get("view") ?? "nps");
  const ageGroup = String(formData.get("ageGroup") ?? "14");
  if (!seasonId) redirect("/admin/team-rankings");

  recomputeRatingsInWorker(seasonId).catch((err) => {
    console.error(`Background ratings recompute failed for season ${seasonId}:`, err);
  });

  redirect(
    `/admin/team-rankings?${new URLSearchParams({ season: seasonId, view, ageGroup, recomputeStarted: "1" })}`,
  );
}

export default async function TeamRankingsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{
    season?: string;
    view?: string;
    ageGroup?: string;
    sort?: string;
    dir?: string;
    recomputeStarted?: string;
  }>;
}) {
  const {
    season: seasonParam,
    view: viewParam,
    ageGroup: ageGroupParam,
    sort,
    dir: dirParam,
    recomputeStarted,
  } = await searchParams;

  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const season = seasons.find((s) => s.id === seasonParam) ?? activeSeason;

  const view: View = viewParam === "power" ? "power" : viewParam === "combine" ? "combine" : "nps";
  const ageGroup = AGE_GROUPS.includes(Number(ageGroupParam)) ? Number(ageGroupParam) : 14;
  const dir: SortDir = dirParam === "desc" ? "desc" : "asc";

  function tabHref(overrides: { view?: View; ageGroup?: number }) {
    const params = new URLSearchParams({
      season: season?.id ?? "",
      view: overrides.view ?? view,
      ageGroup: String(overrides.ageGroup ?? ageGroup),
    });
    return `/admin/team-rankings?${params}`;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Team Rankings</h1>

      {recomputeStarted === "1" && (
        <p className={successBannerClass}>
          Recompute started for Colley, Elo, and Massey across every age group in this
          season — it runs in the background and can take a minute or two. Check the
          &quot;as of&quot; timestamp on Power/Combined Rankings, or just reload in a bit.
        </p>
      )}

      {seasons.length === 0 || !season ? (
        <p className="text-sm text-slate-500">Create a season first (Admin → Seasons).</p>
      ) : (
        <>
          <div className="mb-6 flex items-end gap-3">
            <form method="get" className="flex items-end gap-3">
              <input type="hidden" name="view" value={view} />
              <input type="hidden" name="ageGroup" value={ageGroup} />
              <label className="flex flex-col gap-1 text-sm">
                Season
                <SeasonFilterSelect seasons={seasons} defaultValue={season.id} />
              </label>
            </form>

            <form action={recomputeAll}>
              <input type="hidden" name="seasonId" value={season.id} />
              <input type="hidden" name="view" value={view} />
              <input type="hidden" name="ageGroup" value={ageGroup} />
              <SubmitButton className={primaryButtonClass} pendingText="Recomputing…">
                Recompute ratings
              </SubmitButton>
            </form>
            <p className="pb-2 text-xs text-slate-500">
              Runs Colley, Elo, and Massey for every age group in the selected season.
            </p>
          </div>

          <div className="mb-4 flex gap-1 border-b">
            {VIEWS.map((v) => (
              <Link
                key={v.value}
                href={tabHref({ view: v.value })}
                prefetch={false}
                className={
                  v.value === view
                    ? "border-b-2 border-slate-900 px-3 py-2 text-sm font-medium text-slate-900"
                    : "border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
                }
              >
                {v.label}
              </Link>
            ))}
          </div>

          <div className="mb-6 flex gap-1 border-b">
            {AGE_GROUPS.map((a) => (
              <Link
                key={a}
                href={tabHref({ ageGroup: a })}
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

          {view === "nps" ? (
            <NpsRankingTable
              seasonId={season.id}
              ageGroup={ageGroup}
              sort={sort}
              dir={dir}
              baseParams={new URLSearchParams({ season: season.id, view, ageGroup: String(ageGroup) })}
            />
          ) : view === "power" ? (
            <PowerRankingTable
              seasonId={season.id}
              ageGroup={ageGroup}
              sort={sort}
              dir={dir}
              baseParams={new URLSearchParams({ season: season.id, view, ageGroup: String(ageGroup) })}
            />
          ) : (
            <CombineRankingTable
              seasonId={season.id}
              ageGroup={ageGroup}
              sort={sort}
              dir={dir}
              baseParams={new URLSearchParams({ season: season.id, view, ageGroup: String(ageGroup) })}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Renders a <th> whose label is a link toggling sort by `sortKey` -- ascending on
 * first click, descending on a second click on the same column. `baseParams` carries
 * season/view/ageGroup forward unchanged -- a bare "?sort=...&dir=..." href would be
 * relative to the current query string and drop them instead of merging. */
function SortableHeader({
  sortKey,
  label,
  activeSort,
  dir,
  baseParams,
}: {
  sortKey: string;
  label: string;
  activeSort?: string;
  dir: SortDir;
  baseParams: URLSearchParams;
}) {
  const isActive = activeSort === sortKey;
  const nextDir: SortDir = isActive && dir === "asc" ? "desc" : "asc";
  const params = new URLSearchParams(baseParams);
  params.set("sort", sortKey);
  params.set("dir", nextDir);
  return (
    <th className={thClass}>
      <Link href={`/admin/team-rankings?${params}`} className="hover:underline" scroll={false}>
        {label}
        {isActive && (dir === "asc" ? " ▲" : " ▼")}
      </Link>
    </th>
  );
}

async function NpsRankingTable({
  seasonId,
  ageGroup,
  sort,
  dir,
  baseParams,
}: {
  seasonId: string;
  ageGroup: number;
  sort?: string;
  dir: SortDir;
  baseParams: URLSearchParams;
}) {
  const results = await prisma.rankingResult.findMany({
    where: { seasonId, ageGroup },
    include: {
      team: { include: { club: true } },
      contributions: {
        include: { teamFinish: { include: { division: { include: { event: true } } } } },
        orderBy: { rankInSeason: "asc" },
      },
    },
    orderBy: { rank: "asc" },
  });

  const accessors: Record<string, (r: (typeof results)[number]) => string | number | undefined> = {
    rank: (r) => r.rank,
    team: (r) => r.team.name,
    club: (r) => r.team.club?.name ?? "",
    totalPoints: (r) => r.totalPoints,
  };
  const rows = sort && accessors[sort] ? sortRows(results, accessors[sort], dir) : results;

  return (
    <table className={tableClass}>
      <thead>
        <tr>
          <SortableHeader sortKey="rank" label="Rank" activeSort={sort} dir={dir} baseParams={baseParams} />
          <SortableHeader sortKey="team" label="Team" activeSort={sort} dir={dir} baseParams={baseParams} />
          <SortableHeader sortKey="club" label="Club" activeSort={sort} dir={dir} baseParams={baseParams} />
          <SortableHeader
            sortKey="totalPoints"
            label="Total Points"
            activeSort={sort}
            dir={dir}
            baseParams={baseParams}
          />
          <th className={thClass}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className={tdClass}>{r.rank}</td>
            <td className={tdClass}>
              <Link href={`/admin/teams/${r.team.id}`} prefetch={false} className="text-slate-900 underline">
                {r.team.name}
              </Link>
            </td>
            <td className={tdClass}>{r.team.club?.name ?? ""}</td>
            <td className={tdClass}>{r.totalPoints}</td>
            <td className={tdClass}>
              <details>
                <summary className="cursor-pointer text-slate-500">
                  {r.contributions.length} finish{r.contributions.length === 1 ? "" : "es"}
                </summary>
                <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-600">
                  {r.contributions.map((c) => (
                    <li key={c.id} className={c.countedInTop3 ? "" : "line-through opacity-50"}>
                      {c.teamFinish.division.event.name} ({c.teamFinish.division.name}): {c.points} pts (
                      {c.teamFinish.rank}
                      {ordinalSuffix(c.teamFinish.rank)})
                    </li>
                  ))}
                </ul>
              </details>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td className={tdClass} colSpan={5}>
              No ranked teams yet for this season/age group.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

async function PowerRankingTable({
  seasonId,
  ageGroup,
  sort,
  dir,
  baseParams,
}: {
  seasonId: string;
  ageGroup: number;
  sort?: string;
  dir: SortDir;
  baseParams: URLSearchParams;
}) {
  const data = await getLatestPowerRatings(seasonId, ageGroup);
  const { latestColley, latestElo, latestMassey } = data;
  const defaultRows = buildPowerRows(data);

  // Ordinal "Rank" column, positioned first like NPS Rankings' own persisted `rank` --
  // Avg Rank is the headline number now (see averagePowerRank's comment), so it earns
  // an actual rank position rather than staying a raw averaged value staff have to
  // interpret themselves. Computed once by Avg Rank order regardless of which column
  // the table is currently sorted/displayed by, same as NPS's rank column staying
  // fixed while other columns are sortable.
  const rankByTeamId = assignRanksWithTies(
    sortRows(defaultRows, averagePowerRank, "asc"),
    averagePowerRank,
    (r) => r.team.id,
  );

  const accessors: Record<string, (r: PowerRow) => string | number | undefined> = {
    rank: (r) => rankByTeamId.get(r.team.id),
    team: (r) => r.team.name,
    club: (r) => r.team.club?.name ?? "",
    avgRank: averagePowerRank,
    colleyRank: (r) => r.colley?.rank,
    colleyRating: (r) => r.colley?.rating,
    comparisons: (r) => r.colley?.comparisons,
    eloRank: (r) => r.elo?.rank,
    eloRating: (r) => r.elo?.rating,
    matches: (r) => r.elo?.comparisons,
    masseyRank: (r) => r.massey?.rank,
    masseyRating: (r) => r.massey?.rating,
    games: (r) => r.massey?.comparisons,
  };
  // Default (no explicit column clicked yet) to Avg Rank ascending -- the whole point
  // of the aggregate column is to be the table's headline ranking, not just one more
  // sortable field buried among the per-engine ones.
  const rows =
    sort && accessors[sort]
      ? sortRows(defaultRows, accessors[sort], dir)
      : sortRows(defaultRows, averagePowerRank, "asc");

  return (
    <>
      <div className="mb-4 flex items-center gap-4 text-sm text-slate-500">
        {/* createdAt (the actual recompute run time), not weekEndingDate (the business
            date every same-day rerun collapses onto) -- see getLatestPowerRatings's
            comment for why the two can otherwise look identical for same-day reruns. */}
        {latestColley && <span>Colley as of {latestColley.createdAt.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}</span>}
        {latestElo && <span>Elo as of {latestElo.createdAt.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}</span>}
        {latestMassey && <span>Massey as of {latestMassey.createdAt.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}</span>}
      </div>

      <table className={tableClass}>
        <thead>
          <tr>
            <SortableHeader sortKey="rank" label="Rank" activeSort={sort} dir={dir} baseParams={baseParams} />
            <SortableHeader sortKey="team" label="Team" activeSort={sort} dir={dir} baseParams={baseParams} />
            <SortableHeader sortKey="club" label="Club" activeSort={sort} dir={dir} baseParams={baseParams} />
            <SortableHeader
              sortKey="avgRank"
              label="Avg Rank"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <SortableHeader
              sortKey="colleyRank"
              label="Colley Rank"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <SortableHeader
              sortKey="colleyRating"
              label="Colley Rating"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <SortableHeader
              sortKey="comparisons"
              label="Comparisons"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <SortableHeader
              sortKey="eloRank"
              label="Elo Rank"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <SortableHeader
              sortKey="eloRating"
              label="Elo Rating"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <SortableHeader
              sortKey="matches"
              label="Matches"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <SortableHeader
              sortKey="masseyRank"
              label="Massey Rank"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <SortableHeader
              sortKey="masseyRating"
              label="Massey Rating"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
            <SortableHeader
              sortKey="games"
              label="Games"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ team, colley, elo, massey }) => (
            <tr key={team.id}>
              <td className={tdClass}>{rankByTeamId.get(team.id) ?? "—"}</td>
              <td className={tdClass}>
                <Link href={`/admin/teams/${team.id}`} prefetch={false} className="text-slate-900 underline">
                  {team.name}
                </Link>
              </td>
              <td className={tdClass}>{team.club?.name ?? ""}</td>
              <td className={tdClass}>
                {(() => {
                  const avg = averagePowerRank({ team, colley, elo, massey });
                  return avg !== undefined ? avg.toFixed(1) : "—";
                })()}
              </td>
              <td className={tdClass}>{colley?.rank ?? "—"}</td>
              <td className={tdClass}>{colley ? colley.rating.toFixed(4) : "—"}</td>
              <td className={tdClass}>{colley?.comparisons ?? "—"}</td>
              <td className={tdClass}>{elo?.rank ?? "—"}</td>
              <td className={tdClass}>{elo ? elo.rating.toFixed(4) : "—"}</td>
              <td className={tdClass}>{elo?.comparisons ?? "—"}</td>
              <td className={tdClass}>{massey?.rank ?? "—"}</td>
              <td className={tdClass}>{massey ? massey.rating.toFixed(2) : "—"}</td>
              <td className={tdClass}>{massey?.comparisons ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={13}>
                No ratings yet — click &quot;Recompute ratings&quot; above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

async function CombineRankingTable({
  seasonId,
  ageGroup,
  sort,
  dir,
  baseParams,
}: {
  seasonId: string;
  ageGroup: number;
  sort?: string;
  dir: SortDir;
  baseParams: URLSearchParams;
}) {
  // Sequential awaits (not Promise.all) -- see docs/dev-environment.md.
  const npsResults = await prisma.rankingResult.findMany({
    where: { seasonId, ageGroup },
    include: { team: { include: { club: true } } },
  });
  const powerData = await getLatestPowerRatings(seasonId, ageGroup);
  const powerRows = buildPowerRows(powerData);

  const npsRankByTeam = new Map(npsResults.map((r) => [r.teamId, r.rank]));
  const powerAvgRankByTeam = new Map(powerRows.map((r) => [r.team.id, averagePowerRank(r)]));

  // Union of every team appearing in either ranking -- a team with an NPS finish
  // history but no imported matches yet (or vice versa) still gets a row, just with
  // one side of the blend missing (see combinedScore below).
  const teamById = new Map<string, (typeof npsResults)[number]["team"]>();
  for (const r of npsResults) teamById.set(r.teamId, r.team);
  for (const r of powerRows) teamById.set(r.team.id, r.team);

  type Row = { team: (typeof npsResults)[number]["team"]; npsRank: number | undefined; powerAvgRank: number | undefined };
  const defaultRows: Row[] = Array.from(teamById.entries()).map(([teamId, team]) => ({
    team,
    npsRank: npsRankByTeam.get(teamId),
    powerAvgRank: powerAvgRankByTeam.get(teamId),
  }));

  /**
   * 50% NPS rank + 50% Power Rankings' own Avg Rank (itself the average of Colley/
   * Elo/Massey rank -- see averagePowerRank above), by request: staff wanted one
   * number blending the finish-based NPS ranking with the match-based power-rating
   * consensus, evenly weighted. Both inputs are already ranks (not raw ratings), so
   * they're on the same ordinal scale and a straight mean is meaningful, unlike
   * averaging Colley/Elo/Massey's raw ratings directly (see averagePowerRank's own
   * comment). A team missing one side of the blend (an NPS finish history but no
   * imported matches yet, or vice versa) falls back to 100% the side it has rather
   * than being penalized with a worst-case fill-in for the missing half; a team with
   * neither has no combined score and sorts last (see sortRows).
   */
  function combinedScore(r: Row): number | undefined {
    const parts = [r.npsRank, r.powerAvgRank].filter((v): v is number => v !== undefined);
    if (parts.length === 0) return undefined;
    return parts.reduce((sum, v) => sum + v, 0) / parts.length;
  }

  // Ordinal "Rank" column by Combined Score order -- same convention as NPS Rankings'
  // persisted `rank` and Power Rankings' Avg-Rank-derived `rank` (see
  // PowerRankingTable above): a real "1, 2, 3..." position, held fixed regardless of
  // which column the table is currently sorted/displayed by, not just the raw blended
  // score staff would otherwise have to interpret themselves.
  const rankByTeamId = assignRanksWithTies(
    sortRows(defaultRows, combinedScore, "asc"),
    combinedScore,
    (r) => r.team.id,
  );

  const accessors: Record<string, (r: Row) => string | number | undefined> = {
    rank: (r) => rankByTeamId.get(r.team.id),
    team: (r) => r.team.name,
    club: (r) => r.team.club?.name ?? "",
    combinedScore,
    npsRank: (r) => r.npsRank,
    powerAvgRank: (r) => r.powerAvgRank,
  };
  // Default to Combined Score ascending -- this tab's whole purpose is that one blended
  // number, so it should lead the table unsorted, same convention as Power Rankings'
  // own Avg Rank default.
  const rows =
    sort && accessors[sort] ? sortRows(defaultRows, accessors[sort], dir) : sortRows(defaultRows, combinedScore, "asc");

  return (
    <table className={tableClass}>
      <thead>
        <tr>
          <SortableHeader sortKey="rank" label="Rank" activeSort={sort} dir={dir} baseParams={baseParams} />
          <SortableHeader sortKey="team" label="Team" activeSort={sort} dir={dir} baseParams={baseParams} />
          <SortableHeader sortKey="club" label="Club" activeSort={sort} dir={dir} baseParams={baseParams} />
          <SortableHeader
            sortKey="combinedScore"
            label="Combined Score"
            activeSort={sort}
            dir={dir}
            baseParams={baseParams}
          />
          <SortableHeader
            sortKey="npsRank"
            label="NPS Rank"
            activeSort={sort}
            dir={dir}
            baseParams={baseParams}
          />
          <SortableHeader
            sortKey="powerAvgRank"
            label="Power Avg Rank"
            activeSort={sort}
            dir={dir}
            baseParams={baseParams}
          />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.team.id}>
            <td className={tdClass}>{rankByTeamId.get(r.team.id) ?? "—"}</td>
            <td className={tdClass}>
              <Link href={`/admin/teams/${r.team.id}`} prefetch={false} className="text-slate-900 underline">
                {r.team.name}
              </Link>
            </td>
            <td className={tdClass}>{r.team.club?.name ?? ""}</td>
            <td className={tdClass}>
              {(() => {
                const score = combinedScore(r);
                return score !== undefined ? score.toFixed(1) : "—";
              })()}
            </td>
            <td className={tdClass}>{r.npsRank ?? "—"}</td>
            <td className={tdClass}>{r.powerAvgRank !== undefined ? r.powerAvgRank.toFixed(1) : "—"}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td className={tdClass} colSpan={6}>
              No ranked teams yet for this season/age group.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
