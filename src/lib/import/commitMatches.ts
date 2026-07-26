import { prisma } from "@/lib/prisma";
import { fetchAesMatchResults } from "./aesMatches";
import { resolveAesMatches } from "./resolveMatches";

export type ImportAesMatchesResult =
  | {
      ok: true;
      matchesFetched: number;
      created: number;
      updated: number;
      skipped: number;
      skippedReasons: string[];
    }
  | { ok: false; reason: string };

/**
 * Fetches an AES event's completed matches and upserts them as Match rows, keyed by
 * (eventId, externalMatchId) so a re-run is idempotent. Unlike the TEAM_FINISHES
 * import, this has no separate resolve/preview/commit staging step -- match rows are
 * deterministic (team codes and division labels are already known-good data, not
 * free text needing admin judgment), so fetch+resolve+commit run as one action. See
 * docs/plan.md Phase 5.
 */
export async function importAesMatchResults(
  batchId: string,
  aesEventId: string,
): Promise<ImportAesMatchesResult> {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { event: true },
  });

  let fetchResult;
  try {
    fetchResult = await fetchAesMatchResults(aesEventId);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const teamSeasons = await prisma.teamSeason.findMany({ where: { seasonId: batch.event.seasonId } });
  const finishes = await prisma.teamFinish.findMany({ where: { division: { eventId: batch.eventId } } });

  const teamSeasonByExternalCode = new Map<string, { teamId: string }>();
  for (const ts of teamSeasons) {
    if (ts.externalTeamCode) {
      teamSeasonByExternalCode.set(ts.externalTeamCode.toLowerCase(), { teamId: ts.teamId });
    }
  }
  const divisionIdByTeamId = new Map<string, string>();
  for (const f of finishes) divisionIdByTeamId.set(f.teamId, f.divisionId);

  const { resolved, skipped } = resolveAesMatches(fetchResult.matches, teamSeasonByExternalCode, divisionIdByTeamId);
  const matchesFetchedCount = fetchResult.matches.length;

  let created = 0;
  let updated = 0;

  // Sequential upserts, not a bulk write -- each row needs its own idempotency check
  // (create vs. update an existing Match), and re-imports of a whole event are
  // expected to be occasional/manual, not a hot path. See docs/dev-environment.md on
  // avoiding concurrent Prisma queries in one request.
  await prisma.$transaction(
    async (tx) => {
      for (const m of resolved) {
        const existing = await tx.match.findUnique({
          where: { eventId_externalMatchId: { eventId: batch.eventId, externalMatchId: m.externalMatchId } },
        });
        await tx.match.upsert({
          where: { eventId_externalMatchId: { eventId: batch.eventId, externalMatchId: m.externalMatchId } },
          update: {
            divisionId: m.divisionId,
            teamAId: m.teamAId,
            teamBId: m.teamBId,
            winnerTeamId: m.winnerTeamId,
            matchDate: m.matchDate,
            stage: m.stage,
            setsA: m.setsA,
            setsB: m.setsB,
            setScores: m.setScores,
            importBatchId: batchId,
          },
          create: {
            eventId: batch.eventId,
            externalMatchId: m.externalMatchId,
            divisionId: m.divisionId,
            teamAId: m.teamAId,
            teamBId: m.teamBId,
            winnerTeamId: m.winnerTeamId,
            matchDate: m.matchDate,
            stage: m.stage,
            setsA: m.setsA,
            setsB: m.setsB,
            setScores: m.setScores,
            importBatchId: batchId,
          },
        });
        if (existing) updated += 1;
        else created += 1;
      }

      await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: "COMMITTED",
          committedAt: new Date(),
          summaryJson: {
            matchesFetched: matchesFetchedCount,
            created,
            updated,
            skipped: skipped.length,
            // Capped -- a large event can skip hundreds of matches (most commonly
            // pool-only teams that never received an official TEAM_FINISHES rank),
            // and this is a display cache, not the audit trail.
            skippedReasonSample: skipped.slice(0, 50).map((s) => s.reason),
          },
        },
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  return {
    ok: true,
    matchesFetched: matchesFetchedCount,
    created,
    updated,
    skipped: skipped.length,
    skippedReasons: skipped.map((s) => s.reason),
  };
}
