import type { DivisionGender } from "@/generated/prisma/client";

/**
 * Girls and boys rank in separate buckets: every ranking/rating partition is
 * (seasonId, ageGroup, gender), with a team's bucket taken from Team.gender (set from
 * the AES team code's leading "g"/"b" at import -- see aesTeamCode.ts; kept in line
 * with the codes by prisma/auditTeamGender.ts). Club rankings are still girls-only
 * and read the GIRLS bucket explicitly (see docs/plan.md).
 */
export type RankingGender = Extract<DivisionGender, "GIRLS" | "BOYS">;

export const RANKING_GENDERS: readonly RankingGender[] = ["GIRLS", "BOYS"];

export const RANKING_GENDER_LABEL: Record<RankingGender, string> = { GIRLS: "Girls", BOYS: "Boys" };

/**
 * The ranking bucket a division's population belongs to, for division-level
 * computations (field strength, division weights). COED divisions are rare and
 * have no bucket of their own -- they're measured against girls.
 */
export function partitionGenderForDivision(gender: DivisionGender): RankingGender {
  return gender === "BOYS" ? "BOYS" : "GIRLS";
}

/** The Division.gender values whose divisions belong to a ranking bucket -- the inverse of partitionGenderForDivision, for Division queries. */
export function divisionGendersInPartition(gender: RankingGender): DivisionGender[] {
  return gender === "BOYS" ? ["BOYS"] : ["GIRLS", "COED"];
}

/** Parses a `?gender=` searchParam ("boys"/"girls", any case); anything else is GIRLS. */
export function parseRankingGender(value: string | string[] | undefined | null): RankingGender {
  const v = (Array.isArray(value) ? value[0] : value ?? "").toLowerCase();
  return v === "boys" ? "BOYS" : "GIRLS";
}

/** The `?gender=` searchParam value for a bucket. */
export function rankingGenderParam(gender: RankingGender): string {
  return gender.toLowerCase();
}

/** The gender an AES-style team code's leading "g"/"b" says a team is, or null when it has neither. */
export function genderFromTeamCode(code: string | null | undefined): RankingGender | null {
  const c = (code ?? "").trim().toLowerCase();
  if (c.startsWith("g")) return "GIRLS";
  if (c.startsWith("b")) return "BOYS";
  return null;
}
