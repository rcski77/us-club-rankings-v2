import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { computeCombinedRankByTeam } from "@/lib/rating/powerRankings";
import type { ClubRankingSource } from "@/generated/prisma/enums";
import { AGE_GROUPS, computeClubScore, rankClubs, type BestRankByAgeGroup } from "./clubRanking";

const ALGORITHM_VERSION = "phase7-v1";

/** teamId -> rank within one (season, ageGroup), for whichever per-team ranking
 * `source` selects. NPS reads the persisted RankingResult.rank directly; COMBINED
 * reuses the same Combined Rankings blend the team-rankings pages already compute
 * (see computeCombinedRankByTeam) so club rankings never re-derive that math. */
async function getTeamRanksByAgeGroup(
  seasonId: string,
  ageGroup: number,
  source: ClubRankingSource,
): Promise<Map<string, number>> {
  if (source === "COMBINED") {
    return computeCombinedRankByTeam(seasonId, ageGroup);
  }
  const results = await prisma.rankingResult.findMany({
    where: { seasonId, ageGroup },
    select: { teamId: true, rank: true },
  });
  return new Map(results.map((r) => [r.teamId, r.rank]));
}

/**
 * Recomputes the club-level ranking for a whole season (not per age group -- a
 * club's score spans every age group at once, see docs/plan.md §8), for one ranking
 * `source` at a time -- NPS and COMBINED are independent rollups, stored and shown
 * separately, not blended together. §8's "highest-ranked team only per age group"
 * rule makes this a cheap rollup over data the team-level ranking(s) already
 * produced, not a new team-level computation.
 */
export async function computeClubRankingForSeason(seasonId: string, source: ClubRankingSource = "NPS") {
  // For each (club, ageGroup), keep only the club's best-ranked (lowest rank number)
  // team -- §8 point 2: "the club's highest-ranked team only... not all of the
  // club's teams." Sequential per age group (not Promise.all) -- see
  // docs/dev-environment.md.
  const bestByClub = new Map<string, BestRankByAgeGroup>();
  for (const ageGroup of AGE_GROUPS) {
    const ranksByTeam = await getTeamRanksByAgeGroup(seasonId, ageGroup, source);
    if (ranksByTeam.size === 0) continue;

    const teams = await prisma.team.findMany({
      where: { id: { in: [...ranksByTeam.keys()] } },
      select: { id: true, clubId: true },
    });

    // A club with rankingGroupPrimaryClubId set stays fully independent (own teams,
    // own imports) but its teams' best finishes should fold into another club's
    // rollup instead of publishing their own separate, partial ClubRankingResult --
    // see the field's comment on Club. A club with mergedIntoClubId set has had its
    // Team rows moved to the surviving club already (mergeClubsIntoTarget), so this
    // is a belt-and-suspenders redirect for any team that still points at the merged-
    // away club -- mergedIntoClubId takes priority over rankingGroupPrimaryClubId
    // since a merged-away club is retired outright, not just folded in for scoring.
    // Resolved per age-group batch (not once up front) since it's cheap and keeps
    // this loop self-contained.
    const clubIds = [...new Set(teams.map((t) => t.clubId).filter((id): id is string => id !== null))];
    const clubs = clubIds.length
      ? await prisma.club.findMany({
          where: { id: { in: clubIds } },
          select: { id: true, mergedIntoClubId: true, rankingGroupPrimaryClubId: true },
        })
      : [];
    const rankingClubId = new Map(
      clubs.map((c) => [c.id, c.mergedIntoClubId ?? c.rankingGroupPrimaryClubId ?? c.id]),
    );

    for (const team of teams) {
      if (!team.clubId) continue; // unlinked team -- no club to roll up into
      const targetClubId = rankingClubId.get(team.clubId) ?? team.clubId;
      const rank = ranksByTeam.get(team.id)!;
      const entry = bestByClub.get(targetClubId) ?? {};
      const existing = entry[ageGroup];
      if (!existing || rank < existing.rank) {
        entry[ageGroup] = { teamId: team.id, rank };
      }
      bestByClub.set(targetClubId, entry);
    }
  }

  const scored = Array.from(bestByClub.entries()).map(([clubId, bestRankByAgeGroup]) => {
    const score = computeClubScore(bestRankByAgeGroup);
    return { clubId, ...score };
  });

  const ranked = rankClubs(scored);

  // Pre-generate each ClubRankingResult's id client-side (schema's @default(cuid())
  // only fires when createMany doesn't supply one) so both tables can be bulk-
  // inserted via one createMany call each, instead of the previous per-club
  // create()+createMany() loop -- for a season with a full year of real clubs (over
  // a thousand), that loop's sequential round-trips blew past Prisma's default 5s
  // interactive-transaction timeout on the actual homelab prod hardware ("Invalid
  // `prisma.clubRankingResult.create()` invocation: Transaction API error: A query
  // cannot be executed on an expired transaction"), even after the recompute button
  // itself was moved off the request thread (see the "Club rankings recompute
  // performance fix" note in docs/plan.md -- that fix addressed the *request*
  // timeout, this one addresses a separate *transaction* timeout underneath it). Not
  // a literal cuid (randomUUID() instead) -- the id column is just a String primary
  // key, nothing depends on the specific ID format.
  const rowsWithIds = ranked.map((club) => ({ ...club, id: randomUUID() }));

  await prisma.$transaction(
    async (tx) => {
      await tx.clubRankingResult.deleteMany({ where: { seasonId, source } });
      if (rowsWithIds.length === 0) return;

      await tx.clubRankingResult.createMany({
        data: rowsWithIds.map((club) => ({
          id: club.id,
          seasonId,
          clubId: club.clubId,
          source,
          totalPoints: club.totalPoints,
          rank: club.rank,
          isQualified: club.isQualified,
          algorithmVersion: ALGORITHM_VERSION,
        })),
      });
      await tx.clubRankingResultContribution.createMany({
        data: rowsWithIds.flatMap((club) =>
          club.contributions.map((c) => ({
            clubRankingResultId: club.id,
            ageGroup: c.ageGroup,
            teamId: c.teamId,
            rank: c.rank,
            rawPoints: c.rawPoints,
            weightedPoints: c.weightedPoints,
            countedInBest5: c.countedInBest5,
          })),
        ),
      });
    },
    // Same margin as the other large-batch transactions in this codebase (see
    // commit.ts/commitMatches.ts) -- belt-and-suspenders alongside the createMany
    // batching above, which should already keep this well under even the default.
    { timeout: 120_000, maxWait: 10_000 },
  );
}
