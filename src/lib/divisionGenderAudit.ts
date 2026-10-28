import { prisma } from "@/lib/prisma";
import type { DivisionGender, DivisionScoringStatus } from "@/generated/prisma/enums";
import { majorityFromCounts } from "@/lib/import/divisionGender";
import { computeDivisionScoringSuggestion } from "@/lib/rating/computeDivisionScoringSuggestion";

export type DivisionGenderMismatch = {
  divisionId: string;
  divisionName: string;
  ageGroup: number;
  eventId: string;
  eventName: string;
  eventStartDate: Date;
  scoringStatus: DivisionScoringStatus;
  currentGender: DivisionGender;
  suggestedGender: DivisionGender;
  girlsTeams: number;
  boysTeams: number;
};

/**
 * Divisions whose stored gender disagrees with the majority of the teams actually in
 * them -- the same majority rule imports now use (see import/divisionGender.ts). Most
 * are divisions imported before Division.gender existed, which all defaulted to
 * GIRLS whatever their teams were (e.g. "26 Triple Crown Summer NIT / 15/16 Boys").
 * A wrong label puts the division's field strength, scoring suggestion and Elo/Massey
 * division weight on the wrong girls/boys population (see teamGender.ts); team
 * rankings themselves follow Team.gender and aren't affected.
 *
 * COED divisions are never flagged -- that's a deliberate manual label. Ties count
 * as GIRLS, same as on import. Optionally scoped to one season.
 */
export async function findMislabeledDivisions(seasonId?: string): Promise<DivisionGenderMismatch[]> {
  // Girls/boys team counts per division, aggregated in SQL -- this runs on every
  // dashboard load, and pulling every finish into the app to count it was a large
  // share of that page's server time on prod-sized data.
  const counts = await prisma.$queryRaw<{ divisionId: string; gender: DivisionGender; girls: bigint; boys: bigint }[]>`
    SELECT d."id" AS "divisionId", d."gender"::text AS gender,
           COUNT(*) FILTER (WHERE t."gender" = 'GIRLS') AS girls,
           COUNT(*) FILTER (WHERE t."gender" = 'BOYS') AS boys
    FROM "Division" d
    JOIN "Event" e ON e."id" = d."eventId"
    JOIN "TeamFinish" f ON f."divisionId" = d."id"
    JOIN "Team" t ON t."id" = f."teamId"
    WHERE d."gender" <> 'COED' AND (${seasonId ?? null}::text IS NULL OR e."seasonId" = ${seasonId ?? null})
    GROUP BY d."id", d."gender"`;

  const mismatchCounts = new Map<string, { girls: number; boys: number; suggestedGender: DivisionGender }>();
  for (const c of counts) {
    const girls = Number(c.girls);
    const boys = Number(c.boys);
    const suggestedGender = majorityFromCounts(girls, boys);
    if (suggestedGender !== c.gender) mismatchCounts.set(c.divisionId, { girls, boys, suggestedGender });
  }
  if (mismatchCounts.size === 0) return [];

  const divisions = await prisma.division.findMany({
    where: { id: { in: [...mismatchCounts.keys()] } },
    select: {
      id: true,
      name: true,
      ageGroup: true,
      gender: true,
      scoringStatus: true,
      event: { select: { id: true, name: true, startDate: true } },
    },
  });

  const mismatches: DivisionGenderMismatch[] = [];
  for (const d of divisions) {
    const { girls, boys, suggestedGender } = mismatchCounts.get(d.id)!;
    mismatches.push({
      divisionId: d.id,
      divisionName: d.name,
      ageGroup: d.ageGroup,
      eventId: d.event.id,
      eventName: d.event.name,
      eventStartDate: d.event.startDate,
      scoringStatus: d.scoringStatus,
      currentGender: d.gender,
      suggestedGender,
      girlsTeams: girls,
      boysTeams: boys,
    });
  }
  return mismatches.sort(
    (a, b) => b.eventStartDate.getTime() - a.eventStartDate.getTime() || a.divisionName.localeCompare(b.divisionName),
  );
}

/**
 * Sets a division's gender and, when it actually changed and the division already
 * has a scoring suggestion, refreshes that suggestion against the right girls/boys
 * population -- shared by the division edit form and the Division Genders report.
 * preserveStatus: refreshes the stats only, never reopens a CONFIRMED division or
 * turns a DRAFT one into SUGGESTED. Team rankings follow Team.gender, so they don't
 * need recomputing; Elo/Massey division weights pick the change up on the next
 * ratings recompute.
 */
export async function applyDivisionGender(divisionId: string, gender: DivisionGender): Promise<void> {
  const before = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    select: { gender: true, _count: { select: { scoringSnapshots: true } } },
  });
  if (before.gender === gender) return;
  await prisma.division.update({ where: { id: divisionId }, data: { gender } });
  if (before._count.scoringSnapshots > 0) {
    await computeDivisionScoringSuggestion(divisionId, { preserveStatus: true });
  }
}
