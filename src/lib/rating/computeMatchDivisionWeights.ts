import { prisma } from "@/lib/prisma";
import { computeDivisionFieldStrength } from "./computeDivisionFieldStrength";
import { computeDivisionWeight } from "./divisionWeight";
import { computeFssPercentile } from "./suggestPointTemplate";
import { divisionGendersInPartition, partitionGenderForDivision, type RankingGender } from "@/lib/teamGender";
import type { DivisionGender } from "@/generated/prisma/client";

/**
 * Computes every division's Elo K-factor weight (see divisionWeight.ts) for one
 * (season, ageGroup, gender) partition -- shared by computeMatchDivisionWeights() below (Elo
 * recompute) and the Analysis page (a live display of what a division would
 * contribute to Elo, alongside the scoring-suggestion Band it already shows).
 * Colley-only, deliberately: never computeDivisionScoringSuggestion.ts's Elo/DCI-based
 * percentile, which would be circular here (see divisionWeight.ts's header comment).
 *
 * computeDivisionWeight() ranks a division against every *other* division's
 * percentile in the same partition -- so this gathers every Division with any
 * TeamFinish, not just whichever ones a caller happens to already have in hand, or
 * there'd be nothing real to rank against.
 */
export async function computeDivisionWeightsForPartition(
  seasonId: string,
  ageGroup: number,
  gender: RankingGender,
): Promise<Map<string, number>> {
  const populationRows = await prisma.teamRatingHistory.findMany({
    where: { seasonId, ageGroup, gender, ratingEngine: "COLLEY" },
    orderBy: { weekEndingDate: "desc" },
  });
  const latestByTeam = new Map<string, number>();
  for (const row of populationRows) {
    if (!latestByTeam.has(row.teamId)) latestByTeam.set(row.teamId, row.rating);
  }
  const colleyPopulation = [...latestByTeam.values()];

  const divisions = await prisma.division.findMany({
    where: { ageGroup, gender: { in: divisionGendersInPartition(gender) }, event: { seasonId }, finishes: { some: {} } },
  });

  // Independent per-division lookups (each is its own 2-query round trip) -- see
  // ../../app/admin/CLAUDE.md's Promise.all convention. Previously sequential, which
  // turned a partition with N divisions into N sequential DB round trips on every
  // caller of this function, including getTeamEloHistory on every team-page view.
  const fieldStrengths = await Promise.all(
    divisions.map((division) => computeDivisionFieldStrength(division.id)),
  );

  const percentileByDivision = new Map<string, number>();
  divisions.forEach((division, i) => {
    const fieldStrength = fieldStrengths[i];
    if (fieldStrength.fss === null || fieldStrength.warnings.includes("LOW_PERCENT_RATED")) return;
    const percentile = computeFssPercentile(fieldStrength.fss, colleyPopulation);
    if (percentile !== null) percentileByDivision.set(division.id, percentile);
  });

  const allPercentiles = [...percentileByDivision.values()];
  const weights = new Map<string, number>();
  for (const [divisionId, percentile] of percentileByDivision) {
    weights.set(divisionId, computeDivisionWeight(percentile, allPercentiles));
  }
  return weights;
}

/**
 * Computes each distinct division's Elo K-factor weight for a list of Match-shaped
 * rows, keyed by divisionId -- groups by (season, ageGroup, gender) partition (the
 * division's own bucket, see partitionGenderForDivision) and delegates
 * to computeDivisionWeightsForPartition() above for each one.
 */
export async function computeMatchDivisionWeights(
  matches: {
    divisionId: string | null;
    division: { ageGroup: number; gender: DivisionGender } | null;
    event: { seasonId: string };
  }[],
): Promise<Map<string, number>> {
  const partitions = new Map<string, { seasonId: string; ageGroup: number; gender: RankingGender }>();
  for (const m of matches) {
    if (!m.divisionId || !m.division) continue;
    const gender = partitionGenderForDivision(m.division.gender);
    partitions.set(`${m.event.seasonId}:${m.division.ageGroup}:${gender}`, {
      seasonId: m.event.seasonId,
      ageGroup: m.division.ageGroup,
      gender,
    });
  }

  const weights = new Map<string, number>();
  for (const { seasonId, ageGroup, gender } of partitions.values()) {
    const partitionWeights = await computeDivisionWeightsForPartition(seasonId, ageGroup, gender);
    for (const [divisionId, weight] of partitionWeights) weights.set(divisionId, weight);
  }
  return weights;
}
