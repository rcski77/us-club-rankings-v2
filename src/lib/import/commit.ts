import { prisma } from "@/lib/prisma";
import { uniqueSlug } from "@/lib/slug";
import { resolvePoints } from "@/lib/scoring/resolvePoints";
import { recomputeRankingsForDivision } from "@/lib/ranking/computeRanking";
import { computeLineageKey } from "./lineageKey";
import { isRegionIssueMessage } from "./resolve";
import { blockingReason } from "./rowBlocking";

export type CommitResult = { ok: true } | { ok: false; reason: string };

type PendingAuditFlag = {
  type: "NEW_DIVISION" | "NEW_CLUB" | "NEW_TEAM" | "REIMPORT_UPDATE" | "TIER_DEFAULTED" | "REGION_MISMATCH";
  message: string;
  divisionId?: string;
  clubId?: string;
  teamId?: string;
};

/**
 * Commits a RESOLVED batch: creates any new Divisions/Clubs/Teams/TeamSeasons,
 * upserts TeamFinish rows, writes an AuditFlag audit trail, and recomputes
 * rankings for every touched division. See docs/plan.md Phase 2 for the algorithm.
 *
 * Bulk-writes (createMany) wherever rows share a shape, rather than one Prisma call
 * per row -- a batch with ~1,300 rows previously issued 3,000+ sequential awaited
 * queries inside a single interactive transaction and blew past Prisma's default
 * 5s transaction timeout partway through. The per-row ImportRow "final snapshot"
 * refresh (cosmetic, not needed for referential integrity with the committed data)
 * runs *after* the transaction commits, for the same reason -- it doesn't need to
 * share the transaction's timeout budget.
 */
export async function commitImportBatch(batchId: string): Promise<CommitResult> {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { event: true, files: { include: { rows: true } } },
  });

  if (batch.status !== "RESOLVED") {
    return { ok: false, reason: "Batch must be resolved (and have no pending overrides) before it can be committed." };
  }

  const rows = batch.files.flatMap((f) => f.rows).filter((r) => !r.excluded);

  // isRowBlocking/blockingReason check current override state, not just stored
  // status -- status is a snapshot from the last Resolve pass and goes stale the
  // moment an admin saves a per-row override without re-resolving (e.g. picking a
  // club for a row that was originally flagged AMBIGUOUS doesn't retroactively
  // change that row's stored status away from "ERROR"). Buckets are mutually
  // exclusive by construction, unlike the three separate checks this replaced,
  // which double-counted AMBIGUOUS rows (they always also carry status "ERROR").
  const blockingRows = rows.filter((r) => blockingReason(r) !== null);
  if (blockingRows.length > 0) {
    const errorCount = blockingRows.filter((r) => blockingReason(r) === "error").length;
    const unnamedCount = blockingRows.filter((r) => blockingReason(r) === "unnamedNewClub").length;
    const ambiguousCount = blockingRows.filter((r) => blockingReason(r) === "ambiguousClub").length;
    return {
      ok: false,
      reason: `${blockingRows.length} row(s) still need attention (${errorCount} error, ${unnamedCount} new club needs a name, ${ambiguousCount} ambiguous club).`,
    };
  }

  const unresolvedRows = rows.filter(
    (r) =>
      r.parsedRank == null ||
      r.parsedAgeGroup == null ||
      r.parsedTeamAgeGroup == null ||
      r.parsedTierLabel == null ||
      r.parsedDivisionGender == null ||
      r.parsedClubExternalCode == null ||
      r.parsedTeamNumber == null ||
      r.parsedRegionCodeFromCode == null,
  );
  if (unresolvedRows.length > 0) {
    return { ok: false, reason: `${unresolvedRows.length} row(s) are missing parsed data — run Resolve again.` };
  }

  const touchedDivisionIds = new Set<string>();
  let newDivisionCount = 0;
  let newClubCount = 0;
  let newTeamCount = 0;

  // Lifted above the transaction so the post-commit ImportRow refresh (which runs
  // *after* the transaction, see below) can still resolve each row's final ids.
  const divisionIdByRowId = new Map<string, string>();
  const clubIdByRowId = new Map<string, string>();
  const teamIdByRowId = new Map<string, string>();
  const pendingAuditFlags: PendingAuditFlag[] = [];

  function effectiveDivisionId(row: (typeof rows)[number]): string {
    const id = row.overrideDivisionId ?? row.matchedDivisionId ?? divisionIdByRowId.get(row.id);
    if (!id) throw new Error(`Could not resolve a division for import row ${row.id}.`);
    return id;
  }
  function effectiveClubId(row: (typeof rows)[number]): string | null {
    return row.overrideClubId ?? row.matchedClubId ?? clubIdByRowId.get(row.id) ?? null;
  }
  function effectiveTeamId(row: (typeof rows)[number]): string {
    const id = row.overrideTeamId ?? row.matchedTeamId ?? teamIdByRowId.get(row.id);
    if (!id) throw new Error(`Could not resolve a team for import row ${row.id}.`);
    return id;
  }

  await prisma.$transaction(
    async (tx) => {
      // --- 1. New Divisions ------------------------------------------------------
      // Grouped (and named) by the raw label text verbatim, not a synthesized
      // "${age} ${tier}" guess -- matches resolve.ts's effectiveDivisionKey so the
      // duplicate check and actual division creation always agree, and preserves
      // whatever the source event actually calls its divisions (e.g. "12/13 Club")
      // instead of imposing a renamed "13 Open".
      const newDivisionGroups = new Map<string, typeof rows>();
      for (const row of rows) {
        if (row.divisionMatchType === "NEW" && !row.overrideDivisionId) {
          const key = row.ageGroupLabelRaw.trim().toLowerCase();
          const group = newDivisionGroups.get(key) ?? [];
          group.push(row);
          newDivisionGroups.set(key, group);
        }
      }
      for (const group of newDivisionGroups.values()) {
        const first = group[0];
        const ageGroup = first.parsedAgeGroup!;
        const gender = first.parsedDivisionGender!;
        const tierLabel = first.parsedTierLabel!;
        const tierLevel = first.parsedTierLevel;
        const name = first.ageGroupLabelRaw.trim();
        const slug = await uniqueSlug(name, async (candidate) => {
          const existing = await tx.division.findUnique({
            where: { eventId_slug: { eventId: batch.eventId, slug: candidate } },
          });
          return existing !== null;
        });
        const division = await tx.division.create({
          data: {
            eventId: batch.eventId,
            name,
            slug,
            ageGroup,
            gender,
            tierLabel,
            tierLevel,
            scoringStatus: "DRAFT",
          },
        });
        newDivisionCount += 1;
        for (const row of group) divisionIdByRowId.set(row.id, division.id);
        pendingAuditFlags.push({
          type: "NEW_DIVISION",
          divisionId: division.id,
          message: `Created new division "${division.name}" from import.`,
        });
      }

      // --- 2. New Clubs ------------------------------------------------------------
      const regions = await tx.region.findMany();
      const regionByCode = new Map(regions.map((r) => [r.code.toLowerCase(), r]));
      // Grouped by (club code, region) -- NOT by the typed name text. Multiple rows
      // for the same real club can end up with slightly different saved names (e.g.
      // "Dal Skyline" vs "Dallas Skyline" vs "D Skyline" for the same code+region, all
      // confirmed in real AES data) unless every row was saved through the propagation
      // in actions.ts; grouping by code+region guarantees at most one Club is ever
      // created per real code+region regardless of any such inconsistency.
      const newClubGroups = new Map<string, typeof rows>();
      for (const row of rows) {
        // AMBIGUOUS rows the admin named (rather than pointing at an existing club)
        // are "no, this is genuinely a different club that happens to share a code" --
        // create them as new clubs exactly like a plain NEW row.
        const createAsNew =
          (row.clubMatchType === "NEW" || row.clubMatchType === "AMBIGUOUS") &&
          !row.overrideClubId &&
          row.overrideClubName;
        if (createAsNew) {
          const key = `${row.parsedClubExternalCode}|${row.parsedRegionCodeFromCode ?? ""}`;
          const group = newClubGroups.get(key) ?? [];
          group.push(row);
          newClubGroups.set(key, group);
        }
      }
      for (const group of newClubGroups.values()) {
        const first = group[0];
        const region = first.parsedRegionCodeFromCode
          ? regionByCode.get(first.parsedRegionCodeFromCode)
          : undefined;
        const name = first.overrideClubName!.trim();
        const slug = await uniqueSlug(name, async (candidate) => {
          const existing = await tx.club.findUnique({ where: { slug: candidate } });
          return existing !== null;
        });
        const club = await tx.club.create({
          data: {
            name,
            slug,
            externalCode: first.parsedClubExternalCode,
            regionId: region?.id ?? null,
          },
        });
        newClubCount += 1;
        for (const row of group) clubIdByRowId.set(row.id, club.id);
        pendingAuditFlags.push({
          type: "NEW_CLUB",
          clubId: club.id,
          message: `Created new club "${club.name}" (code "${first.parsedClubExternalCode}") from import.`,
        });
      }

      // --- 3. New Teams + TeamSeasons -----------------------------------------------
      // Grouped by (lineageKey, team's own age) -- NOT lineageKey alone. A club's
      // "team 1" at 14u and "team 1" at 17u share a lineageKey (same code+teamNumber)
      // but are two unrelated rosters; lineageKey alone would incorrectly merge every
      // age group's same-numbered team into one. Team.lineageKey itself still only
      // stores the age-independent value, since it's used to find a *returning*
      // team across seasons (see resolve.ts) -- the age-scoping only applies to
      // *this* grouping decision. Uses parsedTeamAgeGroup (the team's own decoded
      // age), not parsedAgeGroup (the division's nominal age) -- those differ for a
      // team playing up in a combined/mismatched division.
      const newTeamGroups = new Map<string, typeof rows>();
      for (const row of rows) {
        if (row.teamMatchType === "NEW" && !row.overrideTeamId) {
          const lineageKey = computeLineageKey(
            row.parsedClubExternalCode!,
            row.parsedRegionCodeFromCode!,
            row.parsedTeamNumber!,
          );
          const key = `${lineageKey}|${row.parsedTeamAgeGroup}`;
          const group = newTeamGroups.get(key) ?? [];
          group.push(row);
          newTeamGroups.set(key, group);
        }
      }
      for (const group of newTeamGroups.values()) {
        const first = group[0];
        const clubId = effectiveClubId(first);
        const lineageKey = computeLineageKey(
          first.parsedClubExternalCode!,
          first.parsedRegionCodeFromCode!,
          first.parsedTeamNumber!,
        );
        const team = await tx.team.create({
          data: {
            clubId,
            name: first.teamNameClean ?? first.teamCodeRaw,
            lineageKey,
            seasons: {
              create: {
                seasonId: batch.event.seasonId,
                ageGroup: first.parsedTeamAgeGroup!,
                teamNumber: first.parsedTeamNumber!,
                externalTeamCode: first.teamCodeRaw,
              },
            },
          },
        });
        newTeamCount += 1;
        for (const row of group) teamIdByRowId.set(row.id, team.id);
        pendingAuditFlags.push({
          type: "NEW_TEAM",
          teamId: team.id,
          message: `Created new team "${team.name}" from import.`,
        });
      }

      // Existing teams missing a TeamSeason enrollment for this season -- backfill it
      // (a returning team whose lineage matched but wasn't enrolled yet). Also
      // backfill lineageKey on existing teams that don't have one yet. Expected to be
      // a small set in practice (only rows that matched an EXISTING team), so left
      // as individual per-row queries rather than batched.
      for (const row of rows) {
        if (row.teamMatchType !== "EXISTING") continue;
        const teamId = row.overrideTeamId ?? row.matchedTeamId;
        if (!teamId) continue;

        const existingSeason = await tx.teamSeason.findUnique({
          where: { teamId_seasonId: { teamId, seasonId: batch.event.seasonId } },
        });
        if (!existingSeason) {
          await tx.teamSeason.create({
            data: {
              teamId,
              seasonId: batch.event.seasonId,
              ageGroup: row.parsedTeamAgeGroup!,
              teamNumber: row.parsedTeamNumber!,
              externalTeamCode: row.teamCodeRaw,
            },
          });
        }

        const team = await tx.team.findUniqueOrThrow({ where: { id: teamId } });
        if (!team.lineageKey) {
          const lineageKey = computeLineageKey(
            row.parsedClubExternalCode!,
            row.parsedRegionCodeFromCode!,
            row.parsedTeamNumber!,
          );
          await tx.team.update({ where: { id: teamId }, data: { lineageKey } });
        }
      }

      // --- 4. TeamFinish upsert (batched) --------------------------------------------
      const divisionCache = new Map<
        string,
        {
          ageGroup: number;
          scoringStatus: string;
          pointBands: { fromRank: number; toRank: number; points: number }[];
        }
      >();
      const finishesToCreate: {
        divisionId: string;
        teamId: string;
        rank: number;
        tiebreakOrder: number | null;
        points: number | null;
        ignoreAge: boolean;
      }[] = [];
      const finishesToUpdate: {
        id: string;
        rank: number;
        tiebreakOrder: number | null;
        points: number | null;
        ignoreAge: boolean;
      }[] = [];

      for (const row of rows) {
        const divisionId = effectiveDivisionId(row);
        const teamId = effectiveTeamId(row);
        touchedDivisionIds.add(divisionId);

        let division = divisionCache.get(divisionId);
        if (!division) {
          division = await tx.division.findUniqueOrThrow({
            where: { id: divisionId },
            include: { pointBands: true },
          });
          divisionCache.set(divisionId, division);
        }

        const rank = row.parsedRank!;
        // Points stay null until the division is separately confirmed -- matches
        // manual-entry behavior. Exception: a correction re-import into a division
        // that's already CONFIRMED resolves points immediately so the finish doesn't
        // silently fall out of an already-locked-in ranking.
        const points = division.scoringStatus === "CONFIRMED" ? resolvePoints(rank, division.pointBands) : null;
        // A team playing up (or down) from the division's nominal age still earns
        // these points, but its rating comparisons should route to its own natural
        // age group, not the division's -- see docs/plan.md's combined-division notes.
        const ignoreAge = row.parsedTeamAgeGroup !== division.ageGroup;

        if (row.existingTeamFinishId) {
          finishesToUpdate.push({
            id: row.existingTeamFinishId,
            rank,
            tiebreakOrder: row.parsedTiebreakOrder,
            points,
            ignoreAge,
          });
          pendingAuditFlags.push({
            type: "REIMPORT_UPDATE",
            teamId,
            divisionId,
            message: `Updated existing finish to rank ${rank} from re-import.`,
          });
        } else {
          finishesToCreate.push({
            divisionId,
            teamId,
            rank,
            tiebreakOrder: row.parsedTiebreakOrder,
            points,
            ignoreAge,
          });
        }

        if (row.tierWasDefaulted) {
          pendingAuditFlags.push({
            type: "TIER_DEFAULTED",
            divisionId,
            message: `Tier defaulted to Open for label "${row.ageGroupLabelRaw}".`,
          });
        }

        const regionIssue = row.messages.find(isRegionIssueMessage);
        if (regionIssue) {
          pendingAuditFlags.push({ type: "REGION_MISMATCH", teamId, message: regionIssue });
        }
      }

      if (finishesToCreate.length > 0) {
        await tx.teamFinish.createMany({ data: finishesToCreate });
      }
      // Updates vary per row (different existing ids), so createMany doesn't apply --
      // expected to be a small set (re-imports correcting an already-committed
      // division), unlike the create case which is the bulk of a first-time import.
      for (const f of finishesToUpdate) {
        await tx.teamFinish.update({
          where: { id: f.id },
          data: { rank: f.rank, tiebreakOrder: f.tiebreakOrder, points: f.points, ignoreAge: f.ignoreAge },
        });
      }

      // --- 5. Bulk audit trail ---------------------------------------------------------
      if (pendingAuditFlags.length > 0) {
        await tx.auditFlag.createMany({
          data: pendingAuditFlags.map((f) => ({
            importBatchId: batch.id,
            type: f.type,
            divisionId: f.divisionId ?? null,
            clubId: f.clubId ?? null,
            teamId: f.teamId ?? null,
            message: f.message,
          })),
        });
      }

      // --- 6. Finalize batch ---------------------------------------------------------
      await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: "COMMITTED",
          committedAt: new Date(),
          summaryJson: {
            // Every non-excluded row is normalized to OK at commit -- see the
            // post-commit ImportRow refresh below.
            ok: rows.length,
            warning: 0,
            error: 0,
            finishesCommitted: rows.length,
            newDivisions: newDivisionCount,
            newClubs: newClubCount,
            newTeams: newTeamCount,
          },
        },
      });
    },
    // Default interactive-transaction timeout is 5s -- too short for a batch with
    // hundreds/thousands of rows even after batching the bulk writes above (the
    // per-division point-band lookups and the existing-team backfill loop are still
    // per-row). This is a generous ceiling, not an expected duration.
    { timeout: 120_000, maxWait: 10_000 },
  );

  // --- 7. Refresh each row's own snapshot to reflect final post-commit reality ------
  // Otherwise a committed row that started out "NEW" keeps displaying that stale
  // pre-commit label forever, even though the division/club/team now genuinely
  // exists. Pending-concern messages ("needs a name", "resolve manually") are
  // dropped since commit wouldn't have succeeded with those still open;
  // still-relevant informational facts are kept. Runs after the transaction --
  // purely cosmetic, doesn't need to share its timeout budget.
  for (const row of rows) {
    const divisionId = effectiveDivisionId(row);
    const teamId = effectiveTeamId(row);
    const rank = row.parsedRank!;

    const finalMessages: string[] = [];
    if (divisionIdByRowId.has(row.id)) finalMessages.push("New division created from this import.");
    if (clubIdByRowId.has(row.id)) finalMessages.push("New club created from this import.");
    if (teamIdByRowId.has(row.id)) finalMessages.push("New team created from this import.");
    if (row.tierWasDefaulted) {
      finalMessages.push(`Tier defaulted to Open for label "${row.ageGroupLabelRaw}".`);
    }
    const regionIssue = row.messages.find(isRegionIssueMessage);
    if (regionIssue) finalMessages.push(regionIssue);
    if (row.existingTeamFinishId) {
      finalMessages.push(`Updated existing finish to rank ${rank} from re-import.`);
    }

    await prisma.importRow.update({
      where: { id: row.id },
      data: {
        status: "OK",
        divisionMatchType: "EXISTING",
        matchedDivisionId: divisionId,
        clubMatchType: "EXISTING",
        matchedClubId: effectiveClubId(row),
        teamMatchType: "EXISTING",
        matchedTeamId: teamId,
        messages: finalMessages,
      },
    });
  }

  for (const divisionId of touchedDivisionIds) {
    await recomputeRankingsForDivision(divisionId);
  }

  return { ok: true };
}
