import { prisma } from "@/lib/prisma";
import { computeDivisionFieldStrength } from "./computeDivisionFieldStrength";
import { getDivisionEloRatings, getEloPopulationRatings } from "./computeDivisionEloStrength";
import {
  computeDci,
  computeEliteThreshold,
  computeIntrinsicElitePresence,
  computeScaleFactor,
  computeTopQuartileMean,
  ELO_COVERAGE_THRESHOLD,
} from "./dci";
import { computeElitePresence, ELITE_RANK_THRESHOLD } from "./fieldStrength";
import {
  blendPercentileWithElitePresence,
  computeFssPercentile,
  scoreBandForPercentile,
  suggestTemplate,
} from "./suggestPointTemplate";

/**
 * Runs the strength-signal -> percentile -> suggested-template pipeline for a division
 * and persists it as a new DivisionScoringSnapshot (audit trail -- see
 * prisma/CLAUDE.md's "state machine on the entity, audit trail in a separate table"
 * pattern). Sets Division.scoringStatus to SUGGESTED, unless `preserveStatus` is set
 * (used by the bulk "run analysis" action on an already-CONFIRMED division, so staff
 * can refresh a division's FSS/percentile/band as new match data lands post-confirm
 * without silently reopening its finish/band editing -- see admin/analysis's
 * runAnalysisForAll). Does not touch DivisionPointBand or TeamFinish.points -- that
 * only happens on accept (see actions.ts).
 *
 * Per division, prefers the Elo-based DCI blend (see dci.ts) over the original
 * Colley-based FSS/elitePresence blend once at least ELO_COVERAGE_THRESHOLD of the
 * division's teams have Elo ratings (i.e. imported Match data) -- mirrors
 * computeColleyRatings.ts's own per-division match-vs-standings fallback design. The
 * coverage gate matters: a division can have a handful of incidentally-rated teams
 * (e.g. 3 of 64, if just a few of its teams happened to play a match somewhere else in
 * the season) without meaningful match coverage of its own -- DCI computed from that
 * unrepresentative a sample would be worse than the far more complete Colley/standings
 * signal it's meant to improve on. Elo has no standings-inferred fallback of its own
 * (see elo.ts), so a division without enough Match data always falls back to Colley.
 */
export async function computeDivisionScoringSuggestion(
  divisionId: string,
  options: { preserveStatus?: boolean } = {},
) {
  const division = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    include: { event: true },
  });

  const fieldStrength = await computeDivisionFieldStrength(divisionId);
  const eloRatings = await getDivisionEloRatings(divisionId);

  let ratingEngineUsed: "ELO" | "COLLEY";
  let fss: number | null;
  let elitePresence: number | null;
  let percentile: number | null;

  const eloCoverage = fieldStrength.teamCount === 0 ? 0 : eloRatings.length / fieldStrength.teamCount;

  if (eloCoverage >= ELO_COVERAGE_THRESHOLD) {
    ratingEngineUsed = "ELO";
    const ratings = eloRatings.map((r) => r.rating);
    const eloMatchVolume = eloRatings.reduce((sum, r) => sum + r.matchesPlayed, 0);
    const eloPopulation = await getEloPopulationRatings(division.event.seasonId, division.ageGroup);

    fss = computeTopQuartileMean(ratings);
    // eloPopulation always includes this division's own rated teams (same
    // season+ageGroup query), so it's never empty here -- the `?? 1500` fallback is
    // pure type-safety, not expected to ever actually apply.
    const eliteThreshold = computeEliteThreshold(eloPopulation) ?? 1500;
    elitePresence = computeIntrinsicElitePresence(ratings, eliteThreshold);
    const strengthOfFieldPercentile = fss === null ? null : computeFssPercentile(fss, eloPopulation);
    const scaleFactor = computeScaleFactor(fieldStrength.teamCount, eloMatchVolume);
    percentile =
      strengthOfFieldPercentile === null
        ? null
        : computeDci(elitePresence, strengthOfFieldPercentile, scaleFactor);
  } else {
    ratingEngineUsed = "COLLEY";
    // The full (season, ageGroup) rating population -- percentile is computed against
    // this, not against other divisions' FSS values, which is what makes it
    // self-calibrating without needing historical DivisionScoringSnapshot data yet.
    const population = await prisma.teamRatingHistory.findMany({
      where: { seasonId: division.event.seasonId, ageGroup: division.ageGroup, ratingEngine: "COLLEY" },
      orderBy: { weekEndingDate: "desc" },
    });
    const latestByTeam = new Map<string, { rating: number; rank: number }>();
    for (const row of population) {
      if (!latestByTeam.has(row.teamId)) latestByTeam.set(row.teamId, { rating: row.rating, rank: row.rank });
    }
    const populationRatings = Array.from(latestByTeam.values()).map((v) => v.rating);
    const totalEliteTeamsInPopulation = Array.from(latestByTeam.values()).filter(
      (v) => v.rank <= ELITE_RANK_THRESHOLD,
    ).length;

    const fssPercentile =
      fieldStrength.fss === null ? null : computeFssPercentile(fieldStrength.fss, populationRatings);
    elitePresence = computeElitePresence(
      fieldStrength.bucketCounts[ELITE_RANK_THRESHOLD],
      totalEliteTeamsInPopulation,
    );
    fss = fieldStrength.fss;
    percentile =
      fssPercentile === null ? null : blendPercentileWithElitePresence(fssPercentile, elitePresence);
  }

  const scoreBand = percentile === null ? null : scoreBandForPercentile(percentile);

  const templates = await prisma.pointTemplate.findMany({
    where: { isAnchorTemplate: false },
    orderBy: { maxPoints: "desc" },
  });
  const suggestedTemplateId = percentile === null ? null : suggestTemplate(percentile, templates);

  const snapshot = await prisma.$transaction(async (tx) => {
    const created = await tx.divisionScoringSnapshot.create({
      data: {
        divisionId,
        ratingEngineUsed,
        teamCount: fieldStrength.teamCount,
        ratedTeamCount: fieldStrength.ratedTeamCount,
        percentTeamsRated: fieldStrength.percentTeamsRated,
        fss,
        elitePresence,
        percentile,
        scoreBand,
        matchVolume: fieldStrength.matchVolume,
        bucketCounts: fieldStrength.bucketCounts,
        warnings: fieldStrength.warnings,
        suggestedTemplateId,
      },
    });
    if (!options.preserveStatus) {
      await tx.division.update({ where: { id: divisionId }, data: { scoringStatus: "SUGGESTED" } });
    }
    return created;
  });

  return snapshot;
}
