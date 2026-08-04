import { prisma } from "@/lib/prisma";
import { fetchAesMatchResults } from "./aesMatches";
import { fetchSportwrenchMatchResults } from "./sportwrenchMatches";
import { fetchVbscheduleMatchResults } from "./vbscheduleMatches";
import { fetchTm2MatchResults } from "./tm2Matches";
import { resolveAesMatches, type ResolvedMatch, type SkippedMatch } from "./resolveMatches";

export type ImportMatchResultsResult =
  | {
      ok: true;
      matchesFetched: number;
      created: number;
      updated: number;
      skipped: number;
      skippedReasons: string[];
    }
  | { ok: false; reason: string };

// Shared by every source's import*MatchResults() below -- resolving which teams/
// divisions a fetched match's team codes map onto only depends on the event's own
// already-committed TeamSeason/TeamFinish data, never on which platform the match
// itself came from.
async function buildMatchResolutionContext(seasonId: string, eventId: string) {
  const teamSeasons = await prisma.teamSeason.findMany({ where: { seasonId } });
  const finishes = await prisma.teamFinish.findMany({ where: { division: { eventId } } });

  const teamSeasonByExternalCode = new Map<string, { teamId: string }>();
  for (const ts of teamSeasons) {
    if (ts.externalTeamCode) {
      teamSeasonByExternalCode.set(ts.externalTeamCode.toLowerCase(), { teamId: ts.teamId });
    }
  }
  const divisionIdByTeamId = new Map<string, string>();
  for (const f of finishes) divisionIdByTeamId.set(f.teamId, f.divisionId);

  return { teamSeasonByExternalCode, divisionIdByTeamId };
}

// Upserts a resolved+skipped match set and finalizes the batch -- the part that's
// identical regardless of which platform the matches were fetched from.
async function commitResolvedMatches(
  batchId: string,
  eventId: string,
  resolved: ResolvedMatch[],
  skipped: SkippedMatch[],
  matchesFetchedCount: number,
): Promise<ImportMatchResultsResult> {
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
          where: { eventId_externalMatchId: { eventId, externalMatchId: m.externalMatchId } },
        });
        await tx.match.upsert({
          where: { eventId_externalMatchId: { eventId, externalMatchId: m.externalMatchId } },
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
            eventId,
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
): Promise<ImportMatchResultsResult> {
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

  const { teamSeasonByExternalCode, divisionIdByTeamId } = await buildMatchResolutionContext(
    batch.event.seasonId,
    batch.eventId,
  );
  const { resolved, skipped } = resolveAesMatches(fetchResult.matches, teamSeasonByExternalCode, divisionIdByTeamId);

  return commitResolvedMatches(batchId, batch.eventId, resolved, skipped, fetchResult.matches.length);
}

/**
 * Sportwrench analog of importAesMatchResults -- same fetch-then-resolve-then-commit
 * shape, reusing resolveAesMatches() (source-agnostic despite the name, see
 * sportwrenchMatches.ts) and commitResolvedMatches() so the two sources can never
 * drift apart on how a resolved match actually gets written.
 */
export async function importSportwrenchMatchResults(
  batchId: string,
  sportwrenchEventId: string,
): Promise<ImportMatchResultsResult> {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { event: true },
  });

  let fetchResult;
  try {
    fetchResult = await fetchSportwrenchMatchResults(sportwrenchEventId);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const { teamSeasonByExternalCode, divisionIdByTeamId } = await buildMatchResolutionContext(
    batch.event.seasonId,
    batch.eventId,
  );
  const { resolved, skipped } = resolveAesMatches(fetchResult.matches, teamSeasonByExternalCode, divisionIdByTeamId);

  return commitResolvedMatches(batchId, batch.eventId, resolved, skipped, fetchResult.matches.length);
}

/**
 * VBSchedule analog of importAesMatchResults -- same fetch-then-resolve-then-commit
 * shape, reusing resolveAesMatches() (source-agnostic despite the name, see
 * vbscheduleMatches.ts) and commitResolvedMatches() so all three sources can never
 * drift apart on how a resolved match actually gets written.
 */
export async function importVbscheduleMatchResults(
  batchId: string,
  vbscheduleEventId: string,
): Promise<ImportMatchResultsResult> {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { event: true },
  });

  let fetchResult;
  try {
    fetchResult = await fetchVbscheduleMatchResults(vbscheduleEventId);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const { teamSeasonByExternalCode, divisionIdByTeamId } = await buildMatchResolutionContext(
    batch.event.seasonId,
    batch.eventId,
  );
  const { resolved, skipped } = resolveAesMatches(fetchResult.matches, teamSeasonByExternalCode, divisionIdByTeamId);

  return commitResolvedMatches(batchId, batch.eventId, resolved, skipped, fetchResult.matches.length);
}

/**
 * TM2 analog of importAesMatchResults -- same fetch-then-resolve-then-commit shape,
 * reusing resolveAesMatches() (source-agnostic despite the name, see tm2Matches.ts)
 * and commitResolvedMatches() so every source can never drift apart on how a
 * resolved match actually gets written.
 */
export async function importTm2MatchResults(batchId: string, tm2EventId: string): Promise<ImportMatchResultsResult> {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { event: true },
  });

  let fetchResult;
  try {
    fetchResult = await fetchTm2MatchResults(tm2EventId);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const { teamSeasonByExternalCode, divisionIdByTeamId } = await buildMatchResolutionContext(
    batch.event.seasonId,
    batch.eventId,
  );
  const { resolved, skipped } = resolveAesMatches(fetchResult.matches, teamSeasonByExternalCode, divisionIdByTeamId);

  return commitResolvedMatches(batchId, batch.eventId, resolved, skipped, fetchResult.matches.length);
}
