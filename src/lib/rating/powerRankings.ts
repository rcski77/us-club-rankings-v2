import { prisma } from "@/lib/prisma";

export type SortDir = "asc" | "desc";

export function ordinalSuffix(n: number): string {
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
export function sortRows<T>(
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

/**
 * Fetches each engine's latest snapshot for one (season, ageGroup) -- shared by
 * PowerRankingTable and CombineRankingTable so both read the identical rating data
 * rather than two independently-drifting copies of the same three queries. Each engine
 * is recomputed on its own trigger, so its own latest weekEndingDate is found
 * independently rather than assuming all three runs share a date. Sequential awaits
 * throughout (not Promise.all) -- see docs/dev-environment.md.
 */
export async function getLatestPowerRatings(seasonId: string, ageGroup: number) {
  // createdAt (not just weekEndingDate) is selected here so the UI can show when a
  // recompute actually ran, not just which business date it's dated for --
  // weekEndingDate collapses every same-day recompute onto one value by design (see
  // normalizeWeekEndingDate), so two runs on the same day are otherwise
  // indistinguishable to an admin looking at the page.
  const latestColley = await prisma.teamRatingHistory.findFirst({
    where: { seasonId, ageGroup, ratingEngine: "COLLEY" },
    orderBy: { weekEndingDate: "desc" },
    select: { weekEndingDate: true, createdAt: true },
  });
  const latestElo = await prisma.teamRatingHistory.findFirst({
    where: { seasonId, ageGroup, ratingEngine: "ELO" },
    orderBy: { weekEndingDate: "desc" },
    select: { weekEndingDate: true, createdAt: true },
  });
  const latestMassey = await prisma.teamRatingHistory.findFirst({
    where: { seasonId, ageGroup, ratingEngine: "MASSEY" },
    orderBy: { weekEndingDate: "desc" },
    select: { weekEndingDate: true, createdAt: true },
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

  return { latestColley, latestElo, latestMassey, colleyRatings, eloRatings, masseyRatings };
}

export type PowerRatingsData = Awaited<ReturnType<typeof getLatestPowerRatings>>;
export type PowerRow = {
  team: PowerRatingsData["colleyRatings"][number]["team"];
  colley: PowerRatingsData["colleyRatings"][number] | undefined;
  elo: PowerRatingsData["eloRatings"][number] | undefined;
  massey: PowerRatingsData["masseyRatings"][number] | undefined;
};

/** Builds one row per team rated by any engine (order doesn't matter -- both callers
 * sort explicitly): Colley-rated teams first, then any Elo-only team (a division with
 * imported matches but not yet a full standings import), then any Massey-only team
 * (not already covered by either of the above). */
export function buildPowerRows(data: PowerRatingsData): PowerRow[] {
  const { colleyRatings, eloRatings, masseyRatings } = data;
  const eloByTeam = new Map(eloRatings.map((r) => [r.teamId, r]));
  const masseyByTeam = new Map(masseyRatings.map((r) => [r.teamId, r]));

  const colleyTeamIds = new Set(colleyRatings.map((r) => r.teamId));
  const eloOnly = eloRatings.filter((r) => !colleyTeamIds.has(r.teamId));
  const coveredTeamIds = new Set([...colleyTeamIds, ...eloOnly.map((r) => r.teamId)]);
  const masseyOnly = masseyRatings.filter((r) => !coveredTeamIds.has(r.teamId));

  return [
    ...colleyRatings.map((c) => ({
      team: c.team,
      colley: c,
      elo: eloByTeam.get(c.teamId),
      massey: masseyByTeam.get(c.teamId),
    })),
    ...eloOnly.map((e) => ({ team: e.team, colley: undefined, elo: e, massey: masseyByTeam.get(e.teamId) })),
    ...masseyOnly.map((m) => ({ team: m.team, colley: undefined, elo: undefined, massey: m })),
  ];
}

/**
 * The three engines' ratings live on incompatible scales (Colley ~0.7-1.3, Elo
 * ~1500-2000, Massey ~-30 to +30), so averaging raw ratings would just be dominated
 * by whichever engine happens to produce the largest numbers. Averaging each
 * engine's *rank* instead is scale-free -- the same technique used to combine
 * separate sports polls into one composite. Averages over only the engines that have
 * actually rated this team (a team missing from an engine doesn't get penalized with
 * some worst-case fill-in rank); a team rated by zero engines has no avgRank and sorts
 * last, same convention as every other column here (see sortRows). Exported so both
 * the admin and public team-rankings pages' Power/Combine tables reuse the identical
 * number, rather than separate, potentially-inconsistent copies of this math.
 */
export function averagePowerRank(r: PowerRow): number | undefined {
  const ranks = [r.colley?.rank, r.elo?.rank, r.massey?.rank].filter((v): v is number => v !== undefined);
  if (ranks.length === 0) return undefined;
  return ranks.reduce((sum, v) => sum + v, 0) / ranks.length;
}
