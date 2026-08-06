// Non-destructive counterpart to mergeClubsIntoTarget() (see that file's comment for
// the fuller contrast) -- for two clubs that BOTH stay fully independent (their own
// external code, their own imports, their own teams) but should be scored as one
// program for club-rankings purposes, e.g. two active locations of one real club
// ("FORZA1" / "FORZA1 NORTH"). Sets Club.rankingGroupPrimaryClubId on each member,
// read only by computeClubRankingForSeason() -- nothing else about a member club
// changes (isActive stays true, Team.clubId is untouched, import resolution does not
// redirect through this pointer).
import { prisma } from "@/lib/prisma";

export async function combineClubsForRankings(primaryClubId: string, memberClubIds: string[]): Promise<number> {
  const uniqueMemberIds = [...new Set(memberClubIds)].filter((id) => id !== primaryClubId);
  if (uniqueMemberIds.length === 0) {
    throw new Error("Select at least one other club to combine with this one.");
  }

  const [primary, members] = await Promise.all([
    prisma.club.findUniqueOrThrow({ where: { id: primaryClubId } }),
    prisma.club.findMany({
      where: { id: { in: uniqueMemberIds } },
      include: { _count: { select: { rankingGroupMembers: true } } },
    }),
  ]);
  if (primary.mergedIntoClubId) {
    throw new Error(`"${primary.name}" has been merged into another club -- pick the surviving club instead.`);
  }
  if (primary.rankingGroupPrimaryClubId) {
    throw new Error(
      `"${primary.name}" is itself combined into another club for rankings -- pick that club as the target instead.`,
    );
  }
  if (members.length !== uniqueMemberIds.length) {
    throw new Error("One or more selected clubs could not be found.");
  }
  for (const m of members) {
    if (m.mergedIntoClubId) {
      throw new Error(`"${m.name}" has been merged into another club and can't be combined.`);
    }
    if (m.rankingGroupPrimaryClubId && m.rankingGroupPrimaryClubId !== primaryClubId) {
      throw new Error(`"${m.name}" is already combined with a different club for rankings.`);
    }
    if (m._count.rankingGroupMembers > 0) {
      throw new Error(`"${m.name}" already has other clubs combined into it -- combining groups isn't supported.`);
    }
  }

  const result = await prisma.club.updateMany({
    where: { id: { in: uniqueMemberIds } },
    data: { rankingGroupPrimaryClubId: primaryClubId },
  });
  return result.count;
}

export async function removeFromRankingGroup(clubId: string): Promise<void> {
  await prisma.club.update({ where: { id: clubId }, data: { rankingGroupPrimaryClubId: null } });
}
