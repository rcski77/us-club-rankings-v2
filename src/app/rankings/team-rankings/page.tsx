import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import Link from "next/link";
import { brand } from "@/lib/brand";
import {
  tableWrapClass,
  thClass,
  tdClass,
  primaryTdClass,
  secondaryTdClass,
  numThClass,
  numTdClass,
  tbodyClass,
  RankBadge,
} from "@/lib/publicUi";
import {
  ordinalSuffix,
  sortRows,
  getLatestPowerRatings,
  buildPowerRows,
  averagePowerRank,
  assignRanksWithTies,
  type PowerRow,
} from "@/lib/rating/powerRankings";
import { SeasonFilterSelect } from "./SeasonFilterSelect";
import { DEFAULT_PAGE_SIZE, Pagination, parsePage } from "../Pagination";

export const metadata: Metadata = { title: "Team Rankings" };

const AGE_GROUPS = [12, 13, 14, 15, 16, 17, 18];
const VIEWS = [
  { value: "combine", label: "Combined Rankings" },
  { value: "nps", label: "NPS Rankings" },
  { value: "power", label: "Power Rankings" },
] as const;
type View = (typeof VIEWS)[number]["value"];
type SortDir = "asc" | "desc";

export default async function PublicTeamRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    season?: string;
    view?: string;
    ageGroup?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}) {
  const { season: seasonParam, view: viewParam, ageGroup: ageGroupParam, sort, dir: dirParam, page: pageParam } =
    await searchParams;
  const page = parsePage(pageParam);

  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const season = seasons.find((s) => s.id === seasonParam) ?? activeSeason;

  const view: View = viewParam === "power" ? "power" : viewParam === "nps" ? "nps" : "combine";
  const ageGroup = AGE_GROUPS.includes(Number(ageGroupParam)) ? Number(ageGroupParam) : 12;
  const dir: SortDir = dirParam === "desc" ? "desc" : "asc";

  function tabHref(overrides: { view?: View; ageGroup?: number }) {
    const params = new URLSearchParams({
      season: season?.id ?? "",
      view: overrides.view ?? view,
      ageGroup: String(overrides.ageGroup ?? ageGroup),
    });
    return `/rankings/team-rankings?${params}`;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Team Rankings</h1>

      {seasons.length === 0 || !season ? (
        <p className="text-sm text-slate-500">No seasons available yet.</p>
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
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {VIEWS.map((v) => (
              <Link
                key={v.value}
                href={tabHref({ view: v.value })}
                className={
                  v.value === view
                    ? "rounded-full px-4 py-1.5 text-sm font-semibold text-white shadow-sm"
                    : "rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                }
                style={v.value === view ? { backgroundColor: brand.purple } : undefined}
              >
                {v.label}
              </Link>
            ))}
          </div>

          <div className="mb-6 flex flex-wrap gap-1.5">
            {AGE_GROUPS.map((a) => (
              <Link
                key={a}
                href={tabHref({ ageGroup: a })}
                className={
                  a === ageGroup
                    ? "rounded-full px-3 py-1 text-xs font-semibold text-white"
                    : "rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50"
                }
                style={a === ageGroup ? { backgroundColor: brand.teal } : undefined}
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
              page={page}
              baseParams={new URLSearchParams({ season: season.id, view, ageGroup: String(ageGroup) })}
            />
          ) : view === "power" ? (
            <PowerRankingTable
              seasonId={season.id}
              ageGroup={ageGroup}
              sort={sort}
              dir={dir}
              page={page}
              baseParams={new URLSearchParams({ season: season.id, view, ageGroup: String(ageGroup) })}
            />
          ) : (
            <CombineRankingTable
              seasonId={season.id}
              ageGroup={ageGroup}
              sort={sort}
              dir={dir}
              page={page}
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
  narrow = false,
}: {
  sortKey: string;
  label: string;
  activeSort?: string;
  dir: SortDir;
  baseParams: URLSearchParams;
  narrow?: boolean;
}) {
  const isActive = activeSort === sortKey;
  const nextDir: SortDir = isActive && dir === "asc" ? "desc" : "asc";
  const params = new URLSearchParams(baseParams);
  params.set("sort", sortKey);
  params.set("dir", nextDir);
  return (
    <th className={narrow ? numThClass : thClass}>
      <Link href={`/rankings/team-rankings?${params}`} className="hover:text-white" scroll={false}>
        {label}
        {isActive && (dir === "asc" ? " ▲" : " ▼")}
      </Link>
    </th>
  );
}

// Maps a sortable column to a Prisma orderBy clause so the NPS table can page at the
// DB level even under a non-default sort -- sortRows() in JS would require fetching
// every team in the age group first, defeating the point of pagination.
const NPS_ORDER_BY: Record<string, (dir: SortDir) => Prisma.RankingResultOrderByWithRelationInput> = {
  rank: (dir) => ({ rank: dir }),
  team: (dir) => ({ team: { name: dir } }),
  club: (dir) => ({ team: { club: { name: dir } } }),
  totalPoints: (dir) => ({ totalPoints: dir }),
};

async function NpsRankingTable({
  seasonId,
  ageGroup,
  sort,
  dir,
  page,
  baseParams,
}: {
  seasonId: string;
  ageGroup: number;
  sort?: string;
  dir: SortDir;
  page: number;
  baseParams: URLSearchParams;
}) {
  const orderBy: Prisma.RankingResultOrderByWithRelationInput =
    sort && NPS_ORDER_BY[sort] ? NPS_ORDER_BY[sort](dir) : { rank: "asc" };

  // totalCount and rows don't depend on each other's results.
  const [totalCount, rows] = await Promise.all([
    prisma.rankingResult.count({ where: { seasonId, ageGroup } }),
    prisma.rankingResult.findMany({
      where: { seasonId, ageGroup },
      include: {
        team: { include: { club: true } },
        contributions: {
          include: { teamFinish: { include: { division: { include: { event: true } } } } },
          orderBy: { rankInSeason: "asc" },
        },
      },
      orderBy,
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
  ]);

  return (
    <>
    <div className={tableWrapClass}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ backgroundColor: brand.purple }}>
            <SortableHeader sortKey="rank" label="Rank" activeSort={sort} dir={dir} baseParams={baseParams} narrow />
            <SortableHeader sortKey="team" label="Team" activeSort={sort} dir={dir} baseParams={baseParams} />
            <SortableHeader sortKey="club" label="Club" activeSort={sort} dir={dir} baseParams={baseParams} />
            <SortableHeader
              sortKey="totalPoints"
              label="Total Points"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
              narrow
            />
            <th className={thClass}></th>
          </tr>
        </thead>
        <tbody className={tbodyClass}>
          {rows.map((r) => (
            <tr key={r.id} className="cursor-pointer">
              <td className={numTdClass}>
                <RankBadge rank={r.rank} />
              </td>
              <td className={`${primaryTdClass} relative`}>
                <Link href={`/rankings/teams/${r.team.id}`} className="after:absolute after:inset-0 hover:underline">
                  {r.team.name}
                </Link>
              </td>
              <td className={secondaryTdClass}>{r.team.club?.name ?? ""}</td>
              <td className={`${numTdClass} font-semibold`} style={{ color: brand.purple }}>
                {r.totalPoints}
              </td>
              <td className={tdClass}>
                <details className="relative z-10">
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
    </div>
    <Pagination
      page={page}
      totalCount={totalCount}
      pageSize={DEFAULT_PAGE_SIZE}
      basePath="/rankings/team-rankings"
      baseParams={sort ? new URLSearchParams({ ...Object.fromEntries(baseParams), sort, dir }) : baseParams}
    />
    </>
  );
}

async function PowerRankingTable({
  seasonId,
  ageGroup,
  sort,
  dir,
  page,
  baseParams,
}: {
  seasonId: string;
  ageGroup: number;
  sort?: string;
  dir: SortDir;
  page: number;
  baseParams: URLSearchParams;
}) {
  const data = await getLatestPowerRatings(seasonId, ageGroup);
  const { latestColley, latestElo, latestMassey } = data;
  const defaultRows = buildPowerRows(data);

  // Rank is computed across the whole age group (each engine's rank is relative to
  // every other team), so this can't page at the query level like the NPS table --
  // the full set has to be fetched and ranked before slicing out the current page.
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
    eloRank: (r) => r.elo?.rank,
    eloRating: (r) => r.elo?.rating,
    masseyRank: (r) => r.massey?.rank,
    matchesPlayed: (r) => r.colley?.comparisons ?? r.elo?.comparisons ?? r.massey?.comparisons,
  };
  const sortedRows =
    sort && accessors[sort]
      ? sortRows(defaultRows, accessors[sort], dir)
      : sortRows(defaultRows, averagePowerRank, "asc");
  const totalCount = sortedRows.length;
  const rows = sortedRows.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {latestColley && <span>Colley as of {latestColley.weekEndingDate.toLocaleDateString()}</span>}
        {latestElo && <span>Elo as of {latestElo.weekEndingDate.toLocaleDateString()}</span>}
        {latestMassey && <span>Massey as of {latestMassey.weekEndingDate.toLocaleDateString()}</span>}
      </div>

      <div className={tableWrapClass}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: brand.purple }}>
              <SortableHeader sortKey="rank" label="Rank" activeSort={sort} dir={dir} baseParams={baseParams} narrow />
              <SortableHeader sortKey="team" label="Team" activeSort={sort} dir={dir} baseParams={baseParams} />
              <SortableHeader sortKey="club" label="Club" activeSort={sort} dir={dir} baseParams={baseParams} />
              <SortableHeader
                sortKey="avgRank"
                label="Avg Rank"
                activeSort={sort}
                dir={dir}
                baseParams={baseParams}
                narrow
              />
              <SortableHeader
                sortKey="eloRating"
                label="Elo Rating"
                activeSort={sort}
                dir={dir}
                baseParams={baseParams}
                narrow
              />
              <SortableHeader
                sortKey="eloRank"
                label="Elo"
                activeSort={sort}
                dir={dir}
                baseParams={baseParams}
                narrow
              />
              <SortableHeader
                sortKey="colleyRank"
                label="Colley"
                activeSort={sort}
                dir={dir}
                baseParams={baseParams}
                narrow
              />
              <SortableHeader
                sortKey="masseyRank"
                label="Massey"
                activeSort={sort}
                dir={dir}
                baseParams={baseParams}
                narrow
              />
              <SortableHeader
                sortKey="matchesPlayed"
                label="Matches Played"
                activeSort={sort}
                dir={dir}
                baseParams={baseParams}
                narrow
              />
            </tr>
          </thead>
          <tbody className={tbodyClass}>
            {rows.map(({ team, colley, elo, massey }) => (
              <tr key={team.id} className="cursor-pointer">
                <td className={numTdClass}>
                  <RankBadge rank={rankByTeamId.get(team.id)} />
                </td>
                <td className={`${primaryTdClass} relative`}>
                  <Link href={`/rankings/teams/${team.id}`} className="after:absolute after:inset-0 hover:underline">
                    {team.name}
                  </Link>
                </td>
                <td className={secondaryTdClass}>{team.club?.name ?? ""}</td>
                <td className={numTdClass}>
                  {(() => {
                    const avg = averagePowerRank({ team, colley, elo, massey });
                    return avg !== undefined ? avg.toFixed(1) : "—";
                  })()}
                </td>
                <td className={`${numTdClass} font-semibold`} style={{ color: brand.purple }}>
                  {elo ? Math.round(elo.rating) : "—"}
                </td>
                <td className={numTdClass}>{elo?.rank ?? "—"}</td>
                <td className={numTdClass}>{colley?.rank ?? "—"}</td>
                <td className={numTdClass}>{massey?.rank ?? "—"}</td>
                <td className={numTdClass}>
                  {colley?.comparisons ?? elo?.comparisons ?? massey?.comparisons ?? "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={9}>
                  No ratings yet for this season/age group.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        totalCount={totalCount}
        pageSize={DEFAULT_PAGE_SIZE}
        basePath="/rankings/team-rankings"
        baseParams={sort ? new URLSearchParams({ ...Object.fromEntries(baseParams), sort, dir }) : baseParams}
      />
    </>
  );
}

async function CombineRankingTable({
  seasonId,
  ageGroup,
  sort,
  dir,
  page,
  baseParams,
}: {
  seasonId: string;
  ageGroup: number;
  sort?: string;
  dir: SortDir;
  page: number;
  baseParams: URLSearchParams;
}) {
  // npsResults and powerData don't depend on each other's results.
  const [npsResults, powerData] = await Promise.all([
    prisma.rankingResult.findMany({
      where: { seasonId, ageGroup },
      include: { team: { include: { club: true } } },
    }),
    getLatestPowerRatings(seasonId, ageGroup),
  ]);
  const powerRows = buildPowerRows(powerData);

  const npsRankByTeam = new Map(npsResults.map((r) => [r.teamId, r.rank]));
  const powerAvgRankByTeam = new Map(powerRows.map((r) => [r.team.id, averagePowerRank(r)]));

  const teamById = new Map<string, (typeof npsResults)[number]["team"]>();
  for (const r of npsResults) teamById.set(r.teamId, r.team);
  for (const r of powerRows) teamById.set(r.team.id, r.team);

  type Row = { team: (typeof npsResults)[number]["team"]; npsRank: number | undefined; powerAvgRank: number | undefined };
  const defaultRows: Row[] = Array.from(teamById.entries()).map(([teamId, team]) => ({
    team,
    npsRank: npsRankByTeam.get(teamId),
    powerAvgRank: powerAvgRankByTeam.get(teamId),
  }));

  function combinedScore(r: Row): number | undefined {
    const parts = [r.npsRank, r.powerAvgRank].filter((v): v is number => v !== undefined);
    if (parts.length === 0) return undefined;
    return parts.reduce((sum, v) => sum + v, 0) / parts.length;
  }

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
  const sortedRows =
    sort && accessors[sort] ? sortRows(defaultRows, accessors[sort], dir) : sortRows(defaultRows, combinedScore, "asc");
  const totalCount = sortedRows.length;
  const rows = sortedRows.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE);

  return (
    <>
    <div className={tableWrapClass}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ backgroundColor: brand.purple }}>
            <SortableHeader sortKey="rank" label="Rank" activeSort={sort} dir={dir} baseParams={baseParams} narrow />
            <SortableHeader sortKey="team" label="Team" activeSort={sort} dir={dir} baseParams={baseParams} />
            <SortableHeader sortKey="club" label="Club" activeSort={sort} dir={dir} baseParams={baseParams} />
            <SortableHeader
              sortKey="combinedScore"
              label="Combined Score"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
              narrow
            />
            <SortableHeader
              sortKey="npsRank"
              label="NPS Rank"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
              narrow
            />
            <SortableHeader
              sortKey="powerAvgRank"
              label="Power Avg Rank"
              activeSort={sort}
              dir={dir}
              baseParams={baseParams}
              narrow
            />
          </tr>
        </thead>
        <tbody className={tbodyClass}>
          {rows.map((r) => (
            <tr key={r.team.id} className="cursor-pointer">
              <td className={numTdClass}>
                <RankBadge rank={rankByTeamId.get(r.team.id)} />
              </td>
              <td className={`${primaryTdClass} relative`}>
                <Link href={`/rankings/teams/${r.team.id}`} className="after:absolute after:inset-0 hover:underline">
                  {r.team.name}
                </Link>
              </td>
              <td className={secondaryTdClass}>{r.team.club?.name ?? ""}</td>
              <td className={`${numTdClass} font-semibold`} style={{ color: brand.purple }}>
                {(() => {
                  const score = combinedScore(r);
                  return score !== undefined ? score.toFixed(1) : "—";
                })()}
              </td>
              <td className={numTdClass}>{r.npsRank ?? "—"}</td>
              <td className={numTdClass}>{r.powerAvgRank !== undefined ? r.powerAvgRank.toFixed(1) : "—"}</td>
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
    </div>
    <Pagination
      page={page}
      totalCount={totalCount}
      pageSize={DEFAULT_PAGE_SIZE}
      basePath="/rankings/team-rankings"
      baseParams={sort ? new URLSearchParams({ ...Object.fromEntries(baseParams), sort, dir }) : baseParams}
    />
    </>
  );
}
