import type { DivisionGender } from "@/generated/prisma/enums";

/** Normalizes a raw division label for grouping -- the same key commit.ts groups new divisions by. */
export function divisionLabelKey(ageGroupLabelRaw: string): string {
  return ageGroupLabelRaw.trim().toLowerCase();
}

/**
 * A division's gender is decided once for the whole division, by majority of its
 * teams' code genders -- not per row. A mixed division (some "g" and some "b" team
 * codes under one label) stays one division, tagged with whichever gender most of
 * its teams are; each team still keeps its own gender for rankings (Team.gender).
 * A tie, or no recognized codes at all, defaults to GIRLS -- the same default an
 * unrecognized code char gets (see resolve.ts).
 */
export function majorityDivisionGender(genders: (DivisionGender | null | undefined)[]): DivisionGender {
  const { girls, boys } = divisionGenderCounts(genders);
  return majorityFromCounts(girls, boys);
}

/** The same majority rule from pre-counted girls/boys totals (e.g. a SQL aggregate). */
export function majorityFromCounts(girls: number, boys: number): DivisionGender {
  return boys > girls ? "BOYS" : "GIRLS";
}

/** Counts of each gender among a division's team codes, for the mixed-division import warning. */
export function divisionGenderCounts(genders: (DivisionGender | null | undefined)[]) {
  return {
    girls: genders.filter((g) => g === "GIRLS").length,
    boys: genders.filter((g) => g === "BOYS").length,
  };
}
