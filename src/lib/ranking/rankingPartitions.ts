import { prisma } from "@/lib/prisma";
import type { RankingGender } from "@/lib/teamGender";

export type RankingPartition = { ageGroup: number; gender: RankingGender };

/**
 * Every (ageGroup, gender) ranking partition with at least one team enrolled in the
 * season -- a team's natural age group from its TeamSeason row, its bucket from
 * Team.gender (see teamGender.ts). Ordered by gender then age group.
 */
export async function listRankingPartitions(seasonId: string): Promise<RankingPartition[]> {
  const rows = await prisma.teamSeason.findMany({
    where: { seasonId },
    select: { ageGroup: true, team: { select: { gender: true } } },
  });
  const seen = new Map<string, RankingPartition>();
  for (const row of rows) {
    // Team.gender is never COED in practice (it comes from a team code's g/b prefix),
    // but the column shares DivisionGender -- bucket it with girls if it ever is.
    const gender: RankingGender = row.team.gender === "BOYS" ? "BOYS" : "GIRLS";
    seen.set(`${gender}:${row.ageGroup}`, { ageGroup: row.ageGroup, gender });
  }
  return [...seen.values()].sort((a, b) => a.gender.localeCompare(b.gender) || a.ageGroup - b.ageGroup);
}
