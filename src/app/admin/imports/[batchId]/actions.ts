"use server";

import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { parseAesCsv } from "@/lib/import/aesCsv";
import { parseAesEventIdFromUrl } from "@/lib/import/aesEventId";
import { fetchAesStandingsRows } from "@/lib/import/aesStandings";
import { parseSportwrenchEventIdFromUrl } from "@/lib/import/sportwrenchEventId";
import { fetchSportwrenchStandingsRows } from "@/lib/import/sportwrenchStandings";
import { parseVbscheduleEventIdFromUrl } from "@/lib/import/vbscheduleEventId";
import { fetchVbscheduleStandingsRows } from "@/lib/import/vbscheduleStandings";
import { parseTm2EventIdFromUrl } from "@/lib/import/tm2EventId";
import { fetchTm2StandingsRows } from "@/lib/import/tm2Standings";
import { resolveImportBatchInWorker } from "@/lib/import/resolveInWorker";
import { commitImportBatch } from "@/lib/import/commit";
import {
  importAesMatchResultsInWorker,
  importSportwrenchMatchResultsInWorker,
  importVbscheduleMatchResultsInWorker,
} from "@/lib/import/commitMatchesInWorker";
import { suggestClubName } from "@/lib/import/clubNameSuggestion";

function batchPath(batchId: string, params: Record<string, string | undefined> = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return `/admin/imports/${batchId}${query ? `?${query}` : ""}`;
}

// Every mutating form on the batch page carries a hidden "filter" field so the
// current "All" / "Needs attention" view survives the redirect-after-submit --
// without this, saving anything from the filtered view bounced back to "All".
function currentFilter(formData: FormData): string | undefined {
  return String(formData.get("filter") ?? "") || undefined;
}

// A (club code, region) pair identifies one real club -- propagate a club
// override set on one row to every other row in the batch sharing that same
// identity, so the same real club never ends up named/matched differently on
// different rows (and, at commit, is never created as more than one Club).
async function propagateClubOverrideToSiblings(
  batchId: string,
  rowId: string,
  clubExternalCode: string,
  regionCode: string,
  data: { overrideClubId: string | null; overrideClubName: string | null },
) {
  await prisma.importRow.updateMany({
    where: {
      id: { not: rowId },
      importFile: { importBatchId: batchId },
      parsedClubExternalCode: clubExternalCode,
      parsedRegionCodeFromCode: regionCode,
    },
    data,
  });
}

export async function uploadImportFile(batchId: string, formData: FormData) {
  const filter = currentFilter(formData);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(batchPath(batchId, { filter, error: "upload-invalid" }));
  }

  const filename = file.name;
  const existing = await prisma.importFile.findUnique({
    where: { importBatchId_filename: { importBatchId: batchId, filename } },
  });
  if (existing) redirect(batchPath(batchId, { filter, error: "upload-duplicate" }));

  const rawContent = await file.text();
  const partMatch = filename.match(/_part(\d+)/i);
  const partNumber = partMatch ? Number(partMatch[1]) : null;

  const parsed = parseAesCsv(rawContent);

  const importFile = await prisma.importFile.create({
    data: {
      importBatchId: batchId,
      filename,
      partNumber,
      rawContent,
      status: parsed.fileError ? "ERROR" : "PARSED",
      parseError: parsed.fileError,
      rowCount: parsed.rows.length,
    },
  });

  if (!parsed.fileError) {
    await prisma.importRow.createMany({
      data: parsed.rows.map((r) => ({
        importFileId: importFile.id,
        rowNumber: r.rowNumber,
        ageGroupLabelRaw: r.ageGroupLabel,
        rankRaw: r.rank,
        teamNameRaw: r.teamNameField,
        teamCodeRaw: r.teamCode,
      })),
    });
  }

  redirect(batchPath(batchId, { filter }));
}

export async function fetchAesStandings(batchId: string, formData: FormData) {
  const filter = currentFilter(formData);

  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });

  if (batch.scheduleSource !== "AES" || !batch.scheduleUrl) {
    redirect(batchPath(batchId, { filter, error: "no-schedule-url" }));
  }

  const aesEventId = parseAesEventIdFromUrl(batch.scheduleUrl!);
  if (!aesEventId) {
    redirect(batchPath(batchId, { filter, error: "bad-schedule-url" }));
  }

  let result;
  try {
    result = await fetchAesStandingsRows(aesEventId!);
  } catch (err) {
    redirect(
      batchPath(batchId, {
        filter,
        error: "fetch-failed",
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  const filename = `aes-fetch-${Date.now()}.json`;
  const importFile = await prisma.importFile.create({
    data: {
      importBatchId: batchId,
      filename,
      partNumber: null,
      rawContent: JSON.stringify(result.raw),
      status: "PARSED",
      parseError: null,
      rowCount: result.rows.length,
    },
  });

  if (result.rows.length > 0) {
    await prisma.importRow.createMany({
      data: result.rows.map((r) => ({
        importFileId: importFile.id,
        rowNumber: r.rowNumber,
        ageGroupLabelRaw: r.ageGroupLabel,
        rankRaw: r.rank,
        teamNameRaw: r.teamNameField,
        teamCodeRaw: r.teamCode,
        // AES's standings API gives us the club's real name directly -- pre-fill it
        // as the override so a NEW club never needs an admin-typed/heuristic-guessed
        // name (see resolve.ts's "needs an admin-supplied name" warning). Harmless for
        // rows that end up matching an EXISTING club -- commit.ts only reads this
        // field when creating a new Club.
        overrideClubName: r.clubName,
      })),
    });
  }

  redirect(batchPath(batchId, { filter }));
}

export async function fetchAndCommitAesMatches(batchId: string, formData: FormData) {
  const filter = currentFilter(formData);

  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });

  if (batch.scheduleSource !== "AES" || !batch.scheduleUrl) {
    redirect(batchPath(batchId, { filter, error: "no-schedule-url" }));
  }

  const aesEventId = parseAesEventIdFromUrl(batch.scheduleUrl!);
  if (!aesEventId) {
    redirect(batchPath(batchId, { filter, error: "bad-schedule-url" }));
  }

  const result = await importAesMatchResultsInWorker(batchId, aesEventId!);
  if (!result.ok) {
    redirect(batchPath(batchId, { filter, error: "fetch-failed", reason: result.reason }));
  }

  redirect(batchPath(batchId, { filter, success: "committed" }));
}

export async function fetchSportwrenchStandings(batchId: string, formData: FormData) {
  const filter = currentFilter(formData);

  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });

  if (batch.scheduleSource !== "SPORTWRENCH" || !batch.scheduleUrl) {
    redirect(batchPath(batchId, { filter, error: "no-schedule-url" }));
  }

  const swEventId = parseSportwrenchEventIdFromUrl(batch.scheduleUrl!);
  if (!swEventId) {
    redirect(batchPath(batchId, { filter, error: "bad-schedule-url" }));
  }

  let result;
  try {
    result = await fetchSportwrenchStandingsRows(swEventId!);
  } catch (err) {
    redirect(
      batchPath(batchId, {
        filter,
        error: "fetch-failed",
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  const filename = `sportwrench-fetch-${Date.now()}.json`;
  const importFile = await prisma.importFile.create({
    data: {
      importBatchId: batchId,
      filename,
      partNumber: null,
      rawContent: JSON.stringify(result.raw),
      status: "PARSED",
      parseError: null,
      rowCount: result.rows.length,
    },
  });

  if (result.rows.length > 0) {
    await prisma.importRow.createMany({
      data: result.rows.map((r) => ({
        importFileId: importFile.id,
        rowNumber: r.rowNumber,
        ageGroupLabelRaw: r.ageGroupLabel,
        rankRaw: r.rank,
        teamNameRaw: r.teamNameField,
        teamCodeRaw: r.teamCode,
        // Sportwrench's standings response carries the club's real name directly,
        // same as AES's -- see fetchAesStandings's identical comment above.
        overrideClubName: r.clubName,
      })),
    });
  }

  redirect(batchPath(batchId, { filter }));
}

export async function fetchAndCommitSportwrenchMatches(batchId: string, formData: FormData) {
  const filter = currentFilter(formData);

  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });

  if (batch.scheduleSource !== "SPORTWRENCH" || !batch.scheduleUrl) {
    redirect(batchPath(batchId, { filter, error: "no-schedule-url" }));
  }

  const swEventId = parseSportwrenchEventIdFromUrl(batch.scheduleUrl!);
  if (!swEventId) {
    redirect(batchPath(batchId, { filter, error: "bad-schedule-url" }));
  }

  const result = await importSportwrenchMatchResultsInWorker(batchId, swEventId!);
  if (!result.ok) {
    redirect(batchPath(batchId, { filter, error: "fetch-failed", reason: result.reason }));
  }

  redirect(batchPath(batchId, { filter, success: "committed" }));
}

export async function fetchVbscheduleStandings(batchId: string, formData: FormData) {
  const filter = currentFilter(formData);

  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });

  if (batch.scheduleSource !== "VBSCHEDULE" || !batch.scheduleUrl) {
    redirect(batchPath(batchId, { filter, error: "no-schedule-url" }));
  }

  const vbsEventId = parseVbscheduleEventIdFromUrl(batch.scheduleUrl!);
  if (!vbsEventId) {
    redirect(batchPath(batchId, { filter, error: "bad-schedule-url" }));
  }

  let result;
  try {
    result = await fetchVbscheduleStandingsRows(vbsEventId!);
  } catch (err) {
    redirect(
      batchPath(batchId, {
        filter,
        error: "fetch-failed",
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  const filename = `vbschedule-fetch-${Date.now()}.json`;
  const importFile = await prisma.importFile.create({
    data: {
      importBatchId: batchId,
      filename,
      partNumber: null,
      rawContent: JSON.stringify(result.raw),
      status: "PARSED",
      parseError: null,
      rowCount: result.rows.length,
    },
  });

  if (result.rows.length > 0) {
    await prisma.importRow.createMany({
      data: result.rows.map((r) => ({
        importFileId: importFile.id,
        rowNumber: r.rowNumber,
        ageGroupLabelRaw: r.ageGroupLabel,
        rankRaw: r.rank,
        teamNameRaw: r.teamNameField,
        teamCodeRaw: r.teamCode,
        // VBSchedule's team-list response carries the club's real name directly,
        // same as AES's/Sportwrench's -- see fetchAesStandings's identical comment.
        overrideClubName: r.clubName,
      })),
    });
  }

  redirect(batchPath(batchId, { filter }));
}

export async function fetchAndCommitVbscheduleMatches(batchId: string, formData: FormData) {
  const filter = currentFilter(formData);

  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });

  if (batch.scheduleSource !== "VBSCHEDULE" || !batch.scheduleUrl) {
    redirect(batchPath(batchId, { filter, error: "no-schedule-url" }));
  }

  const vbsEventId = parseVbscheduleEventIdFromUrl(batch.scheduleUrl!);
  if (!vbsEventId) {
    redirect(batchPath(batchId, { filter, error: "bad-schedule-url" }));
  }

  const result = await importVbscheduleMatchResultsInWorker(batchId, vbsEventId!);
  if (!result.ok) {
    redirect(batchPath(batchId, { filter, error: "fetch-failed", reason: result.reason }));
  }

  redirect(batchPath(batchId, { filter, success: "committed" }));
}

export async function fetchTm2Standings(batchId: string, formData: FormData) {
  const filter = currentFilter(formData);

  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });

  if (batch.scheduleSource !== "TM2" || !batch.scheduleUrl) {
    redirect(batchPath(batchId, { filter, error: "no-schedule-url" }));
  }

  const tm2EventId = parseTm2EventIdFromUrl(batch.scheduleUrl!);
  if (!tm2EventId) {
    redirect(batchPath(batchId, { filter, error: "bad-schedule-url" }));
  }

  let result;
  try {
    result = await fetchTm2StandingsRows(tm2EventId!);
  } catch (err) {
    redirect(
      batchPath(batchId, {
        filter,
        error: "fetch-failed",
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  const filename = `tm2-fetch-${Date.now()}.json`;
  const importFile = await prisma.importFile.create({
    data: {
      importBatchId: batchId,
      filename,
      partNumber: null,
      rawContent: JSON.stringify(result.raw),
      status: "PARSED",
      parseError: null,
      rowCount: result.rows.length,
    },
  });

  if (result.rows.length > 0) {
    await prisma.importRow.createMany({
      data: result.rows.map((r) => ({
        importFileId: importFile.id,
        rowNumber: r.rowNumber,
        ageGroupLabelRaw: r.ageGroupLabel,
        rankRaw: r.rank,
        teamNameRaw: r.teamNameField,
        teamCodeRaw: r.teamCode,
        // TM2's team-list response carries a club_name field, but it's consistently
        // blank on real data (confirmed against event 2169) -- clubName ends up null
        // for every row here, same as if the field didn't exist, but kept for parity
        // with the AES/Sportwrench/VBSchedule fetchers in case TM2 populates it
        // elsewhere.
        overrideClubName: r.clubName,
      })),
    });
  }

  redirect(batchPath(batchId, { filter }));
}

// Points this batch at one of its event's saved EventSchedule links (or clears it,
// for a manual-CSV-only batch) -- copies url/source onto the batch as a frozen
// snapshot (see ImportBatch.scheduleUrl's comment in schema.prisma), so later edits
// to the EventSchedule list don't retroactively change an in-progress batch.
export async function updateBatchSchedule(batchId: string, formData: FormData) {
  const filter = currentFilter(formData);
  const eventScheduleId = String(formData.get("eventScheduleId") ?? "").trim() || null;

  const schedule = eventScheduleId
    ? await prisma.eventSchedule.findUnique({ where: { id: eventScheduleId } })
    : null;

  await prisma.importBatch.update({
    where: { id: batchId },
    data: { scheduleUrl: schedule?.url ?? null, scheduleSource: schedule?.source ?? null },
  });
  redirect(batchPath(batchId, { filter }));
}

export async function resolveBatch(batchId: string, formData: FormData) {
  await resolveImportBatchInWorker(batchId);
  redirect(batchPath(batchId, { filter: currentFilter(formData) }));
}

export async function overrideRowDivision(batchId: string, rowId: string, formData: FormData) {
  const overrideDivisionId = String(formData.get("overrideDivisionId") ?? "") || null;
  await prisma.importRow.update({ where: { id: rowId }, data: { overrideDivisionId } });
  redirect(batchPath(batchId, { filter: currentFilter(formData) }));
}

export async function overrideRowClub(batchId: string, rowId: string, formData: FormData) {
  const overrideClubId = String(formData.get("overrideClubId") ?? "") || null;
  const overrideClubNameInput = String(formData.get("overrideClubName") ?? "").trim() || null;
  // Picking an existing club from the dropdown takes precedence over a typed name.
  const data = {
    overrideClubId,
    overrideClubName: overrideClubId ? null : overrideClubNameInput,
  };

  const row = await prisma.importRow.update({ where: { id: rowId }, data });

  if (row.parsedClubExternalCode && row.parsedRegionCodeFromCode) {
    await propagateClubOverrideToSiblings(
      batchId,
      rowId,
      row.parsedClubExternalCode,
      row.parsedRegionCodeFromCode,
      data,
    );
  }

  redirect(batchPath(batchId, { filter: currentFilter(formData) }));
}

// One-click version of overrideRowClub for every not-yet-named "new club" row at
// once: rows are grouped by (club code, region) -- the real club identity, not the
// row -- and each group gets a single name applied to every row in it. If any row
// in a group already has a saved name, that name wins (propagating a human's prior
// choice to the rest of the group); otherwise the longest auto-suggested name among
// the group's rows is used as a best guess. Never touches rows the admin has
// already pointed at an existing club via overrideClubId.
export async function saveAllSuggestedClubNames(batchId: string, formData: FormData) {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { files: { include: { rows: true } } },
  });

  const candidateRows = batch.files
    .flatMap((f) => f.rows)
    .filter(
      (r) =>
        !r.excluded &&
        r.clubMatchType === "NEW" &&
        !r.overrideClubId &&
        r.parsedClubExternalCode &&
        r.parsedRegionCodeFromCode,
    );

  const groups = new Map<string, typeof candidateRows>();
  for (const row of candidateRows) {
    const key = `${row.parsedClubExternalCode}|${row.parsedRegionCodeFromCode}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const existingName = group.find((r) => r.overrideClubName)?.overrideClubName;
    const suggestions = group
      .map((r) => (r.teamNameClean ? suggestClubName(r.teamNameClean) : null))
      .filter((n): n is string => Boolean(n))
      .sort((a, b) => b.length - a.length);
    const name = existingName ?? suggestions[0] ?? group[0].teamNameClean ?? group[0].teamNameRaw;

    await prisma.importRow.updateMany({
      where: { id: { in: group.map((r) => r.id) } },
      data: { overrideClubName: name },
    });
  }

  redirect(batchPath(batchId, { filter: currentFilter(formData) }));
}

export async function overrideRowTeam(batchId: string, rowId: string, formData: FormData) {
  const overrideTeamId = String(formData.get("overrideTeamId") ?? "") || null;
  await prisma.importRow.update({ where: { id: rowId }, data: { overrideTeamId } });
  redirect(batchPath(batchId, { filter: currentFilter(formData) }));
}

export async function toggleRowExclude(batchId: string, rowId: string, formData: FormData) {
  const row = await prisma.importRow.findUniqueOrThrow({ where: { id: rowId } });
  await prisma.importRow.update({ where: { id: rowId }, data: { excluded: !row.excluded } });
  redirect(batchPath(batchId, { filter: currentFilter(formData) }));
}

// Deletes a not-yet-committed batch entirely (files/rows cascade), so a batch
// started with stale/wrong data (e.g. fetched before an import-adapter fix landed)
// can be thrown away and restarted from scratch instead of patched row-by-row.
// COMMITTED batches are the durable audit trail for real TeamFinish data that's
// already live -- never deletable from here.
export async function deleteBatch(batchId: string) {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status === "COMMITTED") {
    redirect(batchPath(batchId, { error: "delete-committed" }));
  }
  await prisma.importBatch.delete({ where: { id: batchId } });
  redirect("/admin/imports?success=deleted");
}

export async function commitBatch(batchId: string, formData: FormData) {
  const filter = currentFilter(formData);
  const result = await commitImportBatch(batchId);
  if (!result.ok) {
    redirect(batchPath(batchId, { filter, error: "commit-blocked", reason: result.reason }));
  }
  redirect(batchPath(batchId, { filter, success: "committed" }));
}
