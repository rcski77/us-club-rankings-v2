import { prisma } from "@/lib/prisma";
import {
  buildEloMatches,
  classifyOpponentStrength,
  classifyResult,
  computeEloHistory,
  computeEloRatings as solveElo,
  explainDivisionEffect,
  explainEloChange,
} from "./elo";
import { computeMatchDivisionWeights } from "./computeMatchDivisionWeights";
import { isBoysTeamCode } from "@/lib/teamGender";
import { normalizeWeekEndingDate } from "./weekEndingDate";

/**
 * Gathers the same match set computeEloRatingsForPartition() rates from -- every
 * completed Match belonging to a division that has a relevant (natural-age-group)
 * TeamFinish in this (season, ageGroup) partition, up to asOfDate. Factored out so
 * getTeamEloHistory() can replay the identical graph a team's rating actually came
 * from, not a narrower "just this team's matches" slice (Elo's replay is
 * order/graph-dependent -- see elo.ts). Exported so computeMasseyRatings.ts can reuse
 * the same partition/ignoreAge resolution rather than re-deriving it a third time.
 *
 * Also returns `relevantTeamIds` -- the set of teams whose *own* natural age group is
 * this partition's ageGroup. A division qualifies as relevant here as soon as any one
 * team's finish belongs to this ageGroup, but every match in that division is
 * returned (not just that team's), because an opponent's true strength should reflect
 * having faced a tough team playing up from another age group. That means the match
 * list alone is not enough to know which teams *belong* to this partition -- callers
 * that persist or rank results (not just replay history) must filter down to
 * `relevantTeamIds` first, or a playing-up team ends up with its own rating recorded
 * under the wrong ageGroup (e.g. a 15u team appearing in the 17u power rankings).
 *
 * Deliberately does NOT require the division's scoringStatus to be CONFIRMED. That
 * gate exists elsewhere (computeColleyRatings.ts) because a division's TeamFinish
 * rank is still editable up until confirm (see addTeamFinish/removeTeamFinish/
 * updateTeamFinishRank), so rank-inferred comparisons need to wait for it to settle.
 * Real Match data has no such instability -- it's a separate, non-editable import
 * (Phase 5's MATCH_RESULTS type), so Elo/Massey can rate a division's actual results
 * as soon as they're imported, without waiting on the unrelated point-curve
 * confirmation workflow. TeamFinish rows still exist pre-confirm (created at import
 * commit time, before scoring is even suggested), which is all this query needs them
 * for -- resolving each team's natural age group/ignoreAge, not their rank.
 */
export async function getPartitionMatches(seasonId: string, ageGroup: number, asOfDate: Date) {
  const finishes = await prisma.teamFinish.findMany({
    where: {
      division: { event: { seasonId, startDate: { lte: asOfDate } } },
    },
    include: { division: true },
  });

  const teamSeasons = await prisma.teamSeason.findMany({ where: { seasonId } });
  const naturalAgeGroup = new Map(teamSeasons.map((ts) => [ts.teamId, ts.ageGroup]));
  // Girls rankings only for now -- see teamGender.ts. Shared by Elo and Massey (both
  // call this helper), so filtering here covers both engines and getTeamEloHistory in
  // one place. Filtered out before divisionIds is built, so a boys-only division pulls
  // in no matches at all here (the "ignore the division" effect), not just a discarded
  // final rating -- though it wouldn't affect girls' ratings numerically either way,
  // since Elo/Massey only update the two teams in a given match and boys teams never
  // play girls teams.
  const boysTeamIds = new Set(
    teamSeasons.filter((ts) => isBoysTeamCode(ts.externalTeamCode)).map((ts) => ts.teamId),
  );

  const relevant = finishes.filter(
    (f) =>
      !boysTeamIds.has(f.teamId) &&
      ((f.division.ageGroup === ageGroup && !f.ignoreAge) ||
        (f.ignoreAge && naturalAgeGroup.get(f.teamId) === ageGroup)),
  );
  const relevantTeamIds = new Set(relevant.map((f) => f.teamId));

  const divisionIds = Array.from(new Set(relevant.map((f) => f.divisionId)));
  if (!divisionIds.length) return { matches: [], relevantTeamIds };

  const matches = await prisma.match.findMany({
    where: {
      divisionId: { in: divisionIds },
      winnerTeamId: { not: null },
      matchDate: { not: null, lte: asOfDate },
    },
    include: {
      event: true,
      division: true,
      teamA: { include: { club: true } },
      teamB: { include: { club: true } },
    },
  });

  return { matches, relevantTeamIds };
}

type PartitionMatch = Awaited<ReturnType<typeof getPartitionMatches>>["matches"][number];

/** Attaches each match's divisionWeight (see computeMatchDivisionWeights.ts) so
 * buildEloMatches/solveElo pick it up -- shared by computeEloRatingsForPartition and
 * getTeamEloHistory so a team's history trace is always consistent with the rating it
 * explains. Exported so computeMasseyRatings.ts can reuse the identical weights rather
 * than recomputing them a second, potentially-inconsistent way. */
export async function withDivisionWeights(matches: PartitionMatch[]) {
  const weights = await computeMatchDivisionWeights(matches);
  return matches.map((m) => ({
    ...m,
    divisionWeight: m.divisionId ? weights.get(m.divisionId) : undefined,
    isOpenDivision: m.division?.tierLabel === "OPEN",
    // Prisma's raw Json field, coerced to the shape marginMultiplier() expects --
    // same coercion computeMasseyRatings.ts does independently for the same column,
    // done once here so buildEloMatches() (both call sites below) doesn't repeat it.
    setScores: Array.isArray(m.setScores) ? (m.setScores as unknown as { a: number; b: number }[]) : [],
  }));
}

/**
 * Recomputes Elo ratings for one (season, ageGroup) partition as of asOfDate, and
 * persists a weekly TeamRatingHistory snapshot dated weekEndingDate, mirroring
 * computeColleyRatings()'s delete-and-replace-by-partition pattern and its ignoreAge
 * resolution (a finish's division counts toward the team's natural age group, per
 * that season's TeamSeason row -- see computeColleyRatings.ts for why).
 *
 * Unlike Colley, Elo has no standings-inferred fallback: it only exists once
 * match-level data does (docs/plan.md Phase 5, "Tier 2"), so a division that only has
 * finish ranks (no imported Match rows) contributes nothing here. Its replay is also
 * path-dependent (see elo.ts), so a full recompute always replays every eligible match
 * from scratch up to asOfDate rather than applying an incremental delta on top of a
 * prior snapshot.
 *
 * solveElo() returns a rating for every team in the match graph, which includes any
 * team playing up from another age group (see getPartitionMatches's own comment) --
 * those are filtered out via relevantTeamIds before ranking/persisting, so a team only
 * ever gets a TeamRatingHistory row under its own natural ageGroup.
 */
export async function computeEloRatingsForPartition(
  seasonId: string,
  ageGroup: number,
  asOfDate: Date,
  weekEndingDateRaw: Date,
) {
  // See weekEndingDate.ts -- collapses same-day recomputes onto one timestamp so
  // delete-and-replace below actually replaces instead of piling up.
  const weekEndingDate = normalizeWeekEndingDate(weekEndingDateRaw);

  const { matches, relevantTeamIds } = await getPartitionMatches(seasonId, ageGroup, asOfDate);
  const eloMatches = buildEloMatches(await withDivisionWeights(matches));
  const ratings = solveElo(eloMatches).filter((r) => relevantTeamIds.has(r.teamId));

  ratings.sort((a, b) => b.rating - a.rating);
  let rank = 0;
  let lastRating: number | null = null;
  const ranked = ratings.map((r, i) => {
    if (r.rating !== lastRating) {
      rank = i + 1;
      lastRating = r.rating;
    }
    return { ...r, rank };
  });

  await prisma.$transaction(async (tx) => {
    await tx.teamRatingHistory.deleteMany({
      where: { seasonId, ageGroup, weekEndingDate, ratingEngine: "ELO" },
    });
    if (ranked.length > 0) {
      await tx.teamRatingHistory.createMany({
        data: ranked.map((r) => ({
          teamId: r.teamId,
          seasonId,
          ageGroup,
          weekEndingDate,
          ratingEngine: "ELO" as const,
          rating: r.rating,
          rank: r.rank,
          comparisons: r.matchesPlayed,
        })),
      });
    }
  });

  return ranked;
}

/** Recomputes Elo ratings for every distinct ageGroup with a TeamSeason row this season. */
export async function computeEloRatingsForSeason(
  seasonId: string,
  asOfDate: Date = new Date(),
  weekEndingDate: Date = new Date(),
) {
  const teamSeasons = await prisma.teamSeason.findMany({
    where: { seasonId },
    select: { ageGroup: true },
    distinct: ["ageGroup"],
  });

  const results = new Map<number, Awaited<ReturnType<typeof computeEloRatingsForPartition>>>();
  for (const { ageGroup } of teamSeasons) {
    const ranked = await computeEloRatingsForPartition(seasonId, ageGroup, asOfDate, weekEndingDate);
    results.set(ageGroup, ranked);
  }
  return results;
}

export type TeamEloHistoryEntry = {
  matchId: string;
  matchDate: Date;
  eventId: string;
  eventName: string;
  divisionTierLabel: string | null; // e.g. "OPEN" -- the tier, not the full division name
  opponentTeamId: string;
  opponentName: string;
  opponentClubName: string | null;
  won: boolean;
  thisTeamSets: number;
  opponentSets: number;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  opponentRatingBefore: number;
  opponentStrength: string; // classifyOpponentStrength(expected) -- "much weaker" etc.
  expected: number; // this team's win probability going into the match
  k: number; // base K (24 or 40), before margin/division adjustments
  effectiveWeight: number; // the actual margin*division*openBonus multiplier applied to this side
  multiplier: number;
  resultLabel: string; // classifyResult() -- "Dominant Win (+17 pts)"
  divisionWeight: number;
  isOpenDivision: boolean;
  divisionEffectExplanation: string | null;
  explanation: string;
};

/**
 * A team's full Elo match history within one season, most recent first -- replays the
 * same match graph its current rating came from (see getPartitionMatches above), then
 * slices out just the steps involving this team and reorients each one from "team
 * A/B" into "this team vs. opponent". Returns [] for a team with no TeamSeason row
 * for the season (no natural age group to resolve the partition from) or no rated
 * matches yet.
 */
export async function getTeamEloHistory(
  teamId: string,
  seasonId: string,
  asOfDate: Date = new Date(),
): Promise<TeamEloHistoryEntry[]> {
  const teamSeason = await prisma.teamSeason.findUnique({
    where: { teamId_seasonId: { teamId, seasonId } },
  });
  if (!teamSeason) return [];

  const { matches } = await getPartitionMatches(seasonId, teamSeason.ageGroup, asOfDate);
  const byId = new Map(matches.map((m) => [m.id, m]));

  const steps = computeEloHistory(buildEloMatches(await withDivisionWeights(matches)));
  const teamSteps = steps.filter((s) => s.teamAId === teamId || s.teamBId === teamId);

  const entries: TeamEloHistoryEntry[] = teamSteps.map((s) => {
    const match = byId.get(s.matchId)!;
    const isA = s.teamAId === teamId;
    const opponent = isA ? match.teamB : match.teamA;

    const ratingBefore = isA ? s.ratingABefore : s.ratingBBefore;
    const ratingAfter = isA ? s.ratingAAfter : s.ratingBAfter;
    const opponentRatingBefore = isA ? s.ratingBBefore : s.ratingABefore;
    const expected = isA ? s.expectedA : 1 - s.expectedA;
    const k = isA ? s.kA : s.kB;
    const effectiveWeight = isA ? s.effectiveWeightA : s.effectiveWeightB;
    const won = s.winnerTeamId === teamId;
    const delta = ratingAfter - ratingBefore;

    return {
      matchId: s.matchId,
      matchDate: s.matchDate,
      eventId: match.eventId,
      eventName: match.event.name,
      divisionTierLabel: match.division?.tierLabel ?? null,
      opponentTeamId: opponent?.id ?? "",
      opponentName: opponent?.name ?? "(unresolved)",
      opponentClubName: opponent?.club?.name ?? null,
      won,
      thisTeamSets: isA ? s.setsA : s.setsB,
      opponentSets: isA ? s.setsB : s.setsA,
      ratingBefore,
      ratingAfter,
      delta,
      opponentRatingBefore,
      opponentStrength: classifyOpponentStrength(expected),
      expected,
      k,
      effectiveWeight,
      multiplier: s.multiplier,
      resultLabel: classifyResult({ won, multiplier: s.multiplier, delta }),
      divisionWeight: s.divisionWeight,
      isOpenDivision: s.isOpenDivision,
      divisionEffectExplanation: explainDivisionEffect({
        won,
        divisionWeight: s.divisionWeight,
        isOpenDivision: s.isOpenDivision,
      }),
      explanation: explainEloChange({ won, expected, multiplier: s.multiplier }),
    };
  });

  return entries.sort((a, b) => b.matchDate.getTime() - a.matchDate.getTime());
}
