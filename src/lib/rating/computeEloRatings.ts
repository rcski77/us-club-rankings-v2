import { prisma } from "@/lib/prisma";
import {
  buildEloMatches,
  classifyOpponentStrength,
  classifyResult,
  computeEloHistory,
  explainDivisionEffect,
  explainEloChange,
} from "./elo";
import { computeMatchDivisionWeights } from "./computeMatchDivisionWeights";
import { isBoysTeamCode } from "@/lib/teamGender";
import { normalizeWeekEndingDate } from "./weekEndingDate";
import { PARTITION_TRANSACTION_MAX_WAIT } from "@/lib/concurrency";

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
 *
 * Optional `cache`: this same heavy query (with event/division/team+club includes)
 * gets called for both Elo and Massey on the same partition, moments apart, for
 * identical (seasonId, ageGroup, asOfDate) args -- see
 * computeEloMasseyPartitionWorkerEntry.ts, which runs both in one process sharing
 * one cache Map, so Massey doesn't re-fetch and re-hydrate everything Elo already
 * did. Callers that don't pass one (e.g. getTeamEloHistory's single-team lookups)
 * are unaffected.
 */
export async function getPartitionMatches(
  seasonId: string,
  ageGroup: number,
  asOfDate: Date,
  cache?: PartitionMatchesCache,
) {
  if (!cache) return fetchPartitionMatches(seasonId, ageGroup, asOfDate);
  const key = `${seasonId}|${ageGroup}|${asOfDate.getTime()}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchPartitionMatches(seasonId, ageGroup, asOfDate);
    cache.set(key, pending);
  }
  return pending;
}

export type PartitionMatchesCache = Map<string, ReturnType<typeof fetchPartitionMatches>>;

async function fetchPartitionMatches(seasonId: string, ageGroup: number, asOfDate: Date) {
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
  // final rating. A mixed division (girls and boys teams both with relevant finishes)
  // still pulls in every match below, including genuine cross-gender ones -- those are
  // separately filtered out just after the query (see the allMatches/matches split).
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

  const allMatches = await prisma.match.findMany({
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

  // A genuinely mixed division can pit a boys team against a girls team as a
  // real, intentional match (not a data error -- see the Mintonette/lineageKey
  // postmortem in docs/plan.md for the *unintentional* cross-gender case this is
  // NOT). Treated like an exhibition game: it still shows in a team's own match
  // history (that query goes straight to Match, not through here), but never
  // feeds Elo/Massey, since rating a girls team off a boys opponent (or vice
  // versa) has no meaningful signal for either engine.
  const matches = allMatches.filter((m) => !m.teamA || !m.teamB || m.teamA.gender === m.teamB.gender);

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
 * Final ratings are derived from computeEloHistory()'s own per-match steps (rather
 * than calling computeEloRatings() separately, which would replay the same graph a
 * second time) -- every team that appears in the match graph gets a final rating,
 * which includes any team playing up from another age group (see
 * getPartitionMatches's own comment); those are filtered out via relevantTeamIds
 * before ranking/persisting, so a team only ever gets a TeamRatingHistory row under
 * its own natural ageGroup.
 *
 * Also persists a TeamEloMatchStep row per (match, relevant team) -- the same steps
 * this function already computed, kept so getTeamEloHistory() can read a team's
 * match-by-match trace directly instead of re-replaying the whole partition on every
 * team-page view (see that model's schema comment). Delete-and-replace by
 * (seasonId, ageGroup), same pattern as the TeamRatingHistory snapshot below.
 */
export async function computeEloRatingsForPartition(
  seasonId: string,
  ageGroup: number,
  asOfDate: Date,
  weekEndingDateRaw: Date,
  cache?: PartitionMatchesCache,
) {
  // See weekEndingDate.ts -- collapses same-day recomputes onto one timestamp so
  // delete-and-replace below actually replaces instead of piling up.
  const weekEndingDate = normalizeWeekEndingDate(weekEndingDateRaw);

  const { matches, relevantTeamIds } = await getPartitionMatches(seasonId, ageGroup, asOfDate, cache);
  const eloMatches = buildEloMatches(await withDivisionWeights(matches));
  const steps = computeEloHistory(eloMatches);

  const finalRating = new Map<string, number>();
  const matchesPlayed = new Map<string, number>();
  for (const step of steps) {
    finalRating.set(step.teamAId, step.ratingAAfter);
    finalRating.set(step.teamBId, step.ratingBAfter);
    matchesPlayed.set(step.teamAId, (matchesPlayed.get(step.teamAId) ?? 0) + 1);
    matchesPlayed.set(step.teamBId, (matchesPlayed.get(step.teamBId) ?? 0) + 1);
  }

  const ratings = Array.from(finalRating.entries())
    .map(([teamId, rating]) => ({ teamId, rating, matchesPlayed: matchesPlayed.get(teamId) ?? 0 }))
    .filter((r) => relevantTeamIds.has(r.teamId));

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

  // One row per side of a step whose team is relevant to this partition -- a team's
  // home partition is always its own natural age group (see getTeamEloHistory), so a
  // team can only ever be relevant in exactly one (seasonId, ageGroup) run per season.
  const stepRows: {
    matchId: string;
    teamId: string;
    opponentTeamId: string;
    won: boolean;
    thisTeamSets: number;
    opponentSets: number;
    ratingBefore: number;
    ratingAfter: number;
    opponentRatingBefore: number;
    expected: number;
    k: number;
    effectiveWeight: number;
    multiplier: number;
    divisionWeight: number;
    isOpenDivision: boolean;
  }[] = [];
  for (const step of steps) {
    if (relevantTeamIds.has(step.teamAId)) {
      stepRows.push({
        matchId: step.matchId,
        teamId: step.teamAId,
        opponentTeamId: step.teamBId,
        won: step.winnerTeamId === step.teamAId,
        thisTeamSets: step.setsA,
        opponentSets: step.setsB,
        ratingBefore: step.ratingABefore,
        ratingAfter: step.ratingAAfter,
        opponentRatingBefore: step.ratingBBefore,
        expected: step.expectedA,
        k: step.kA,
        effectiveWeight: step.effectiveWeightA,
        multiplier: step.multiplier,
        divisionWeight: step.divisionWeight,
        isOpenDivision: step.isOpenDivision,
      });
    }
    if (relevantTeamIds.has(step.teamBId)) {
      stepRows.push({
        matchId: step.matchId,
        teamId: step.teamBId,
        opponentTeamId: step.teamAId,
        won: step.winnerTeamId === step.teamBId,
        thisTeamSets: step.setsB,
        opponentSets: step.setsA,
        ratingBefore: step.ratingBBefore,
        ratingAfter: step.ratingBAfter,
        opponentRatingBefore: step.ratingABefore,
        expected: 1 - step.expectedA,
        k: step.kB,
        effectiveWeight: step.effectiveWeightB,
        multiplier: step.multiplier,
        divisionWeight: step.divisionWeight,
        isOpenDivision: step.isOpenDivision,
      });
    }
  }

  // Two separate transactions, not one -- this table used to be written alongside
  // TeamEloMatchStep in a single transaction, but that let TeamEloMatchStep's insert
  // volume (one row per team per match in the partition -- 64k+ for the largest age
  // group) risk the timing of this much smaller, more important write too. A slow or
  // failed step-write should never block the "as of" rating/rank staff actually look
  // at from landing. This write itself is always small, but PARTITION_TRANSACTION_MAX_WAIT
  // is applied to both maxWait and timeout anyway -- concurrent partitions (see
  // PARTITION_PROCESS_CONCURRENCY in rankingComputeServer.ts) put this table under
  // enough contention that even a small write can occasionally miss the 5s default.
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
  }, { maxWait: PARTITION_TRANSACTION_MAX_WAIT, timeout: PARTITION_TRANSACTION_MAX_WAIT });

  await prisma.$transaction(
    async (tx) => {
      await tx.teamEloMatchStep.deleteMany({ where: { seasonId, ageGroup } });
      if (stepRows.length > 0) {
        await tx.teamEloMatchStep.createMany({
          data: stepRows.map((s) => ({ ...s, seasonId, ageGroup })),
        });
      }
    },
    // This table's delete-and-replace (one row per team per match in the partition)
    // repeatedly ran past the default 5s, then a bumped 60s, interactive-transaction
    // timeout on the largest age-group partition (64k+ rows) -- see the migration
    // adding an index on the deleteMany's (seasonId, ageGroup) filter, which turned
    // out not to be the bottleneck (EXPLAIN ANALYZE showed the delete itself takes
    // ~300ms once indexed): the real cost is the createMany insert volume. 300s is
    // generous headroom for today's data, but still a moving target as more matches
    // get imported each season -- if this times out again, the next step is batching
    // the createMany into chunks rather than raising the timeout further. maxWait
    // (separate from timeout -- see PARTITION_TRANSACTION_MAX_WAIT) covers waiting
    // for a free connection when multiple partitions try to start this at once.
    { timeout: 300_000, maxWait: PARTITION_TRANSACTION_MAX_WAIT },
  );

  return ranked;
}

export type EventEloSummary = {
  /** This team's Elo rating as of the partition replay reaching asOfDate (i.e.
   * including this event's own matches) -- undefined if the team has no rated match
   * in the partition by then. */
  rating: number | undefined;
  /** Net rating change from just this event's matches (0 if the team played matches
   * in this event but they summed to no net change; undefined if the team played no
   * rated match in this event). */
  delta: number | undefined;
  /** Win-loss record from just this event's rated matches (Match rows with a resolved
   * winner and matchDate -- see buildEloMatches). Both 0 if the team played no rated
   * match in this event. */
  wins: number;
  losses: number;
};

/**
 * Per-team Elo rating (as of this event, within its season/ageGroup partition) plus
 * the net rating change contributed by just this event's own matches -- for the
 * public event/division page, which wants to show "how did this event move a team's
 * Elo" alongside its finish, not the full match-by-match history getTeamEloHistory()
 * gives a single team. Replays the partition once (same graph
 * computeEloRatingsForPartition() rates from) and buckets each step's delta by
 * whether its source Match.eventId matches this event, rather than calling
 * getTeamEloHistory() per team, which would redundantly re-replay the same partition
 * once per team on the page.
 */
export async function getEventEloSummaries(
  eventId: string,
  seasonId: string,
  ageGroup: number,
  asOfDate: Date,
): Promise<Map<string, EventEloSummary>> {
  const { matches } = await getPartitionMatches(seasonId, ageGroup, asOfDate);
  const matchById = new Map(matches.map((m) => [m.id, m]));
  const steps = computeEloHistory(buildEloMatches(await withDivisionWeights(matches)));

  const rating = new Map<string, number>();
  const delta = new Map<string, number>();
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();

  for (const step of steps) {
    rating.set(step.teamAId, step.ratingAAfter);
    rating.set(step.teamBId, step.ratingBAfter);

    if (matchById.get(step.matchId)?.eventId === eventId) {
      delta.set(step.teamAId, (delta.get(step.teamAId) ?? 0) + (step.ratingAAfter - step.ratingABefore));
      delta.set(step.teamBId, (delta.get(step.teamBId) ?? 0) + (step.ratingBAfter - step.ratingBBefore));

      const winnerId = step.winnerTeamId;
      const loserId = winnerId === step.teamAId ? step.teamBId : step.teamAId;
      wins.set(winnerId, (wins.get(winnerId) ?? 0) + 1);
      losses.set(loserId, (losses.get(loserId) ?? 0) + 1);
    }
  }

  const summaries = new Map<string, EventEloSummary>();
  for (const teamId of rating.keys()) {
    summaries.set(teamId, {
      rating: rating.get(teamId),
      delta: delta.get(teamId),
      wins: wins.get(teamId) ?? 0,
      losses: losses.get(teamId) ?? 0,
    });
  }
  return summaries;
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
 * A team's full Elo match history within one season, most recent first -- reads the
 * TeamEloMatchStep rows computeEloRatingsForPartition() already persisted for this
 * team's (season, natural ageGroup) partition, rather than re-replaying the whole
 * partition's match graph on every call (see that model's schema comment; this used
 * to be the dominant cost on the team-detail page). Elo's replay is strictly
 * chronological, so a stored step's before/after values are already correct for any
 * asOfDate -- only the set of *which* steps are visible as of that date changes.
 * Returns [] for a team with no TeamSeason row for the season (no natural age group
 * to resolve the partition from) or no rated matches yet.
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

  const steps = await prisma.teamEloMatchStep.findMany({
    where: {
      teamId,
      seasonId,
      ageGroup: teamSeason.ageGroup,
      match: { matchDate: { lte: asOfDate } },
    },
    include: {
      match: { include: { event: true, division: true } },
      opponent: { include: { club: true } },
    },
    orderBy: { match: { matchDate: "desc" } },
  });

  return steps.map((s) => {
    const delta = s.ratingAfter - s.ratingBefore;
    return {
      matchId: s.matchId,
      matchDate: s.match.matchDate!,
      eventId: s.match.eventId,
      eventName: s.match.event.name,
      divisionTierLabel: s.match.division?.tierLabel ?? null,
      opponentTeamId: s.opponentTeamId,
      opponentName: s.opponent.name,
      opponentClubName: s.opponent.club?.name ?? null,
      won: s.won,
      thisTeamSets: s.thisTeamSets,
      opponentSets: s.opponentSets,
      ratingBefore: s.ratingBefore,
      ratingAfter: s.ratingAfter,
      delta,
      opponentRatingBefore: s.opponentRatingBefore,
      opponentStrength: classifyOpponentStrength(s.expected),
      expected: s.expected,
      k: s.k,
      effectiveWeight: s.effectiveWeight,
      multiplier: s.multiplier,
      resultLabel: classifyResult({ won: s.won, multiplier: s.multiplier, delta }),
      divisionWeight: s.divisionWeight,
      isOpenDivision: s.isOpenDivision,
      divisionEffectExplanation: explainDivisionEffect({
        won: s.won,
        divisionWeight: s.divisionWeight,
        isOpenDivision: s.isOpenDivision,
      }),
      explanation: explainEloChange({ won: s.won, expected: s.expected, multiplier: s.multiplier }),
    };
  });
}
