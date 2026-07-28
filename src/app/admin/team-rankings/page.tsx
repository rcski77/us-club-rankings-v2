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
import { computeColleyRatingsForSeason } from "@/lib/rating/computeColleyRatings";
import { computeEloRatingsForSeason } from "@/lib/rating/computeEloRatings";
import { computeMasseyRatingsForSeason } from "@/lib/rating/computeMasseyRatings";
import { SeasonFilterSelect } from "./SeasonFilterSelect";

const AGE_GROUPS = [12, 13, 14, 15, 16, 17, 18];
const VIEWS = [
  { value: "nps", label: "NPS Rankings" },
  { value: "power", label: "Power Rankings" },
] as const;
type View = (typeof VIEWS)[number]["value"];
type SortDir = "asc" | "desc";

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** Sorts rows by an accessor's value, ascending or descending; rows where the
 * accessor returns null/undefined (a team not yet rated by that engine, e.g.) always
 * sort last regardless of direction, rather than clustering at whichever end the
 * direction happens to put them. */
function sortRows<T>(
  rows: T[],
  accessor: (row: T) => string | number | undefined | null,
  dir: SortDir,
): T[] {
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return dir === "desc" ? -cmp : cmp;
  });
}

/** Recomputes Colley, Elo, and Massey ratings for the whole season in one action -- the
 * three engines used to have separate buttons, but staff always want all three current
 * together, not one at a time. */
async function recomputeAll(formData: FormData) {
  "use server";
  const seasonId = String(formData.get("seasonId") ?? "");
  const view = String(formData.get("view") ?? "nps");
  const ageGroup = String(formData.get("ageGroup") ?? "14");
  if (!seasonId) redirect("/admin/team-rankings");

  await computeColleyRatingsForSeason(seasonId);
  await computeEloRatingsForSeason(seasonId);
  await computeMasseyRatingsForSeason(seasonId);

  redirect(
    `/admin/team-rankings?${new URLSearchParams({ season: seasonId, view, ageGroup, recomputed: "1" })}`,
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
    recomputed?: string;
  }>;
}) {
  const {
    season: seasonParam,
    view: viewParam,
    ageGroup: ageGroupParam,
    sort,
    dir: dirParam,
    recomputed,
  } = await searchParams;

  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const season = seasons.find((s) => s.id === seasonParam) ?? activeSeason;

  const view: View = viewParam === "power" ? "power" : "nps";
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

      {recomputed === "1" && (
        <p className={successBannerClass}>
          Colley, Elo, and Massey ratings recomputed for every age group in this season.
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
              <button type="submit" className={primaryButtonClass}>
                Recompute ratings
              </button>
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
          ) : (
            <PowerRankingTable
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
              <Link href={`/admin/teams/${r.team.id}`} className="text-slate-900 underline">
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
  // Each engine is recomputed on its own trigger, so its own latest weekEndingDate is
  // found independently rather than assuming all three runs share a date. Sequential
  // awaits throughout (not Promise.all) -- see docs/dev-environment.md.
  const latestColley = await prisma.teamRatingHistory.findFirst({
    where: { seasonId, ageGroup, ratingEngine: "COLLEY" },
    orderBy: { weekEndingDate: "desc" },
    select: { weekEndingDate: true },
  });
  const latestElo = await prisma.teamRatingHistory.findFirst({
    where: { seasonId, ageGroup, ratingEngine: "ELO" },
    orderBy: { weekEndingDate: "desc" },
    select: { weekEndingDate: true },
  });
  const latestMassey = await prisma.teamRatingHistory.findFirst({
    where: { seasonId, ageGroup, ratingEngine: "MASSEY" },
    orderBy: { weekEndingDate: "desc" },
    select: { weekEndingDate: true },
  });

  const colleyRatings = latestColley
    ? await prisma.teamRatingHistory.findMany({
        where: { seasonId, ageGroup, ratingEngine: "COLLEY", weekEndingDate: latestColley.weekEndingDate },
        include: { team: { include: { club: true } } },
        orderBy: { rank: "asc" },
      })
    : [];
  const eloRatings = latestElo
    ? await prisma.teamRatingHistory.findMany({
        where: { seasonId, ageGroup, ratingEngine: "ELO", weekEndingDate: latestElo.weekEndingDate },
        include: { team: { include: { club: true } } },
      })
    : [];
  const masseyRatings = latestMassey
    ? await prisma.teamRatingHistory.findMany({
        where: { seasonId, ageGroup, ratingEngine: "MASSEY", weekEndingDate: latestMassey.weekEndingDate },
        include: { team: { include: { club: true } } },
      })
    : [];

  const eloByTeam = new Map(eloRatings.map((r) => [r.teamId, r]));
  const masseyByTeam = new Map(masseyRatings.map((r) => [r.teamId, r]));

  // Default (unsorted) row order: every team rated by any engine. Colley-rated teams
  // come first, in Colley rank order (today's larger/more-established rating source),
  // then any Elo-only team (a division with imported matches but not yet a full
  // standings import) in Elo rank order, then any Massey-only team (not already
  // covered by either of the above) in Massey rank order. Clicking a column header
  // overrides this with a straight sort by that column instead (see sortRows).
  const colleyTeamIds = new Set(colleyRatings.map((r) => r.teamId));
  const eloOnly = eloRatings.filter((r) => !colleyTeamIds.has(r.teamId)).sort((a, b) => a.rank - b.rank);
  const coveredTeamIds = new Set([...colleyTeamIds, ...eloOnly.map((r) => r.teamId)]);
  const masseyOnly = masseyRatings
    .filter((r) => !coveredTeamIds.has(r.teamId))
    .sort((a, b) => a.rank - b.rank);

  type Row = {
    team: (typeof colleyRatings)[number]["team"];
    colley: (typeof colleyRatings)[number] | undefined;
    elo: (typeof eloRatings)[number] | undefined;
    massey: (typeof masseyRatings)[number] | undefined;
  };

  const defaultRows: Row[] = [
    ...colleyRatings.map((c) => ({
      team: c.team,
      colley: c,
      elo: eloByTeam.get(c.teamId),
      massey: masseyByTeam.get(c.teamId),
    })),
    ...eloOnly.map((e) => ({ team: e.team, colley: undefined, elo: e, massey: masseyByTeam.get(e.teamId) })),
    ...masseyOnly.map((m) => ({ team: m.team, colley: undefined, elo: undefined, massey: m })),
  ];

  const accessors: Record<string, (r: Row) => string | number | undefined> = {
    team: (r) => r.team.name,
    club: (r) => r.team.club?.name ?? "",
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
  const rows = sort && accessors[sort] ? sortRows(defaultRows, accessors[sort], dir) : defaultRows;

  return (
    <>
      <div className="mb-4 flex items-center gap-4 text-sm text-slate-500">
        {latestColley && <span>Colley as of {latestColley.weekEndingDate.toLocaleDateString()}</span>}
        {latestElo && <span>Elo as of {latestElo.weekEndingDate.toLocaleDateString()}</span>}
        {latestMassey && <span>Massey as of {latestMassey.weekEndingDate.toLocaleDateString()}</span>}
      </div>

      <table className={tableClass}>
        <thead>
          <tr>
            <SortableHeader sortKey="team" label="Team" activeSort={sort} dir={dir} baseParams={baseParams} />
            <SortableHeader sortKey="club" label="Club" activeSort={sort} dir={dir} baseParams={baseParams} />
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
              <td className={tdClass}>
                <Link href={`/admin/teams/${team.id}`} className="text-slate-900 underline">
                  {team.name}
                </Link>
              </td>
              <td className={tdClass}>{team.club?.name ?? ""}</td>
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
              <td className={tdClass} colSpan={11}>
                No ratings yet — click &quot;Recompute ratings&quot; above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
