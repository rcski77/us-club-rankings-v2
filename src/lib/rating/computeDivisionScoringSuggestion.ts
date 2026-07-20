import { prisma } from "@/lib/prisma";
import { computeDivisionFieldStrength } from "./computeDivisionFieldStrength";
import {
  computeFssPercentile,
  scoreBandForPercentile,
  suggestTemplate,
} from "./suggestPointTemplate";

/**
 * Runs the full FSS -> percentile -> suggested-template pipeline for a division and
 * persists it as a new DivisionScoringSnapshot (audit trail -- see prisma/CLAUDE.md's
 * "state machine on the entity, audit trail in a separate table" pattern). Sets
 * Division.scoringStatus to SUGGESTED. Does not touch DivisionPointBand or
 * TeamFinish.points -- that only happens on accept (see actions.ts).
 */
export async function computeDivisionScoringSuggestion(divisionId: string) {
  const division = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    include: { event: true },
  });

  const fieldStrength = await computeDivisionFieldStrength(divisionId);

  // The full (season, ageGroup) rating population -- percentile is computed against
  // this, not against other divisions' FSS values, which is what makes it
  // self-calibrating without needing historical DivisionScoringSnapshot data yet.
  const population = await prisma.teamRatingHistory.findMany({
    where: {
      seasonId: division.event.seasonId,
      ageGroup: division.ageGroup,
      ratingEngine: "COLLEY",
    },
    orderBy: { weekEndingDate: "desc" },
  });
  const latestByTeam = new Map<string, number>();
  for (const row of population) {
    if (!latestByTeam.has(row.teamId)) latestByTeam.set(row.teamId, row.rating);
  }
  const populationRatings = Array.from(latestByTeam.values());

  const percentile =
    fieldStrength.fss === null ? null : computeFssPercentile(fieldStrength.fss, populationRatings);
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
        teamCount: fieldStrength.teamCount,
        ratedTeamCount: fieldStrength.ratedTeamCount,
        percentTeamsRated: fieldStrength.percentTeamsRated,
        fss: fieldStrength.fss,
        percentile,
        scoreBand,
        matchVolume: fieldStrength.matchVolume,
        bucketCounts: fieldStrength.bucketCounts,
        warnings: fieldStrength.warnings,
        suggestedTemplateId,
      },
    });
    await tx.division.update({ where: { id: divisionId }, data: { scoringStatus: "SUGGESTED" } });
    return created;
  });

  return snapshot;
}
