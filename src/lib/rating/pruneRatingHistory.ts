import { prisma } from "@/lib/prisma";

/** Day of week (Postgres EXTRACT(DOW): 0 = Sunday) whose snapshot is kept as the weekly record. */
export const WEEKLY_SNAPSHOT_DOW = 2; // Tuesday

/**
 * Trims a season's TeamRatingHistory to each (ageGroup, gender, engine) partition's
 * latest snapshot plus one snapshot per week -- the Tuesday one. weekEndingDate is the
 * recompute's UTC calendar day (see weekEndingDate.ts), so the nightly run at 2 AM
 * Eastern on Tuesday is the Tuesday snapshot. If that run fails, the week simply has
 * no weekly record.
 *
 * Every reader only ever wants the latest snapshot (see latestRatings.ts and
 * powerRankings.ts); the Tuesday snapshots are kept for future week-over-week
 * movement/trend views. Without this the table grew by a full snapshot per nightly
 * run (~55k rows/day in prod). Run at the end of every ratings recompute (see
 * rankingComputeServer.ts), so the latest snapshot always exists before older ones are
 * judged against it. Returns the number of rows deleted.
 */
export async function pruneRatingHistory(seasonId: string): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM "TeamRatingHistory" h
    USING (
      SELECT "ageGroup", "gender", "ratingEngine", MAX("weekEndingDate") AS latest
      FROM "TeamRatingHistory"
      WHERE "seasonId" = ${seasonId}
      GROUP BY 1, 2, 3
    ) l
    WHERE h."seasonId" = ${seasonId}
      AND h."ageGroup" = l."ageGroup" AND h."gender" = l."gender" AND h."ratingEngine" = l."ratingEngine"
      AND h."weekEndingDate" < l.latest
      AND EXTRACT(DOW FROM h."weekEndingDate") <> ${WEEKLY_SNAPSHOT_DOW}`;
}
