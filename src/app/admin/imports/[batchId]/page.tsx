import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { suggestClubName } from "@/lib/import/clubNameSuggestion";
import { blockingReason } from "@/lib/import/rowBlocking";
import { SubmitButton } from "@/components/SubmitButton";
import {
  uploadImportFile,
  fetchAesStandings,
  fetchAndCommitAesMatches,
  fetchSportwrenchStandings,
  fetchAndCommitSportwrenchMatches,
  resolveBatch,
  updateBatchSchedule,
  overrideRowDivision,
  overrideRowClub,
  overrideRowTeam,
  toggleRowExclude,
  commitBatch,
  deleteBatch,
  saveAllSuggestedClubNames,
} from "./actions";
import {
  inputClass,
  selectClass,
  fileInputClass,
  primaryButtonClass,
  secondaryButtonClass,
  smallSecondaryButtonClass,
  errorBannerClass,
  successBannerClass,
  tableClass,
  thClass,
  tdClass,
} from "@/lib/ui";
import type { ImportSource } from "@/generated/prisma/enums";

const STATUS_COLORS: Record<string, string> = {
  OK: "text-green-700",
  WARNING: "text-amber-700",
  ERROR: "text-red-700",
  PENDING: "text-slate-500",
};

export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ error?: string; reason?: string; success?: string; filter?: string }>;
}) {
  const { batchId } = await params;
  const { error, reason, success, filter } = await searchParams;
  const showOnlyAttention = filter === "attention";

  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: {
      event: { include: { season: true, schedules: { orderBy: { createdAt: "asc" } } } },
      files: { include: { rows: { orderBy: { rowNumber: "asc" } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!batch) notFound();

  if (batch.importType === "MATCH_RESULTS") {
    return <MatchResultsBatchView batch={batch} error={error} reason={reason} success={success} />;
  }

  const allRows = batch.files.flatMap((f) =>
    f.rows.map((r) => ({ ...r, filename: f.filename, partNumber: f.partNumber })),
  );
  // Scopes the team-override dropdown to the clubs this batch's rows actually
  // reference instead of dumping every team in the system into it -- with real-sized
  // data (1000+ teams) that unscoped fetch was the other half of the page-lockup bug
  // the club-override fix below addresses.
  const clubIdsInBatch = [
    ...new Set(allRows.flatMap((r) => [r.matchedClubId, r.overrideClubId].filter((id): id is string => !!id))),
  ];
  // matchedTeamId is looked up directly (row.matchedTeamId below) and can in theory
  // belong to a club outside clubIdsInBatch (e.g. lineage-matched across a club
  // change), so it's included explicitly rather than relying on the club scoping.
  const matchedTeamIdsInBatch = [...new Set(allRows.map((r) => r.matchedTeamId).filter((id): id is string => !!id))];

  // divisions, clubs, and teams don't depend on each other's results.
  const [divisions, clubs, teams] = await Promise.all([
    prisma.division.findMany({
      where: { eventId: batch.eventId },
      orderBy: [{ ageGroup: "desc" }, { name: "asc" }],
    }),
    prisma.club.findMany({ orderBy: { name: "asc" } }),
    prisma.team.findMany({
      where: { OR: [{ clubId: { in: clubIdsInBatch } }, { id: { in: matchedTeamIdsInBatch } }] },
      orderBy: { name: "asc" },
      include: { club: true },
    }),
  ]);

  const divisionById = new Map(divisions.map((d) => [d.id, d]));
  const clubById = new Map(clubs.map((c) => [c.id, c]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamsByClubId = new Map<string, typeof teams>();
  for (const t of teams) {
    if (!t.clubId) continue;
    const list = teamsByClubId.get(t.clubId) ?? [];
    list.push(t);
    teamsByClubId.set(t.clubId, list);
  }
  const isDraft = batch.status === "DRAFT";
  const isCommitted = batch.status === "COMMITTED";

  const activeRows = allRows.filter((r) => !r.excluded);
  // Live/override-aware, not the (possibly stale) stored `status` -- saving an
  // override on a row doesn't retroactively update its status until the next
  // Resolve. This is the same definition commit.ts uses, so this count, the
  // "Needs attention" filter, and what commit will actually accept always agree.
  const needsAttentionRows = activeRows.filter((r) => blockingReason(r) !== null);
  const visibleRows = showOnlyAttention ? needsAttentionRows : allRows;
  const errorCount = activeRows.filter((r) => blockingReason(r) === "error").length;
  const unnamedNewClubCount = activeRows.filter((r) => blockingReason(r) === "unnamedNewClub").length;
  const ambiguousClubCount = activeRows.filter((r) => blockingReason(r) === "ambiguousClub").length;
  const blockedCount = needsAttentionRows.length;
  const canCommit = batch.status === "RESOLVED" && blockedCount === 0;

  const summary = batch.summaryJson as
    | { ok?: number; warning?: number; error?: number; newDivisions?: number; newClubs?: number; newTeams?: number }
    | null;

  const uploadWithId = uploadImportFile.bind(null, batchId);
  const fetchAesStandingsWithId = fetchAesStandings.bind(null, batchId);
  const fetchSportwrenchStandingsWithId = fetchSportwrenchStandings.bind(null, batchId);
  const resolveWithId = resolveBatch.bind(null, batchId);
  const commitWithId = commitBatch.bind(null, batchId);
  const deleteWithId = deleteBatch.bind(null, batchId);
  const saveAllSuggestedClubNamesWithId = saveAllSuggestedClubNames.bind(null, batchId);
  const updateBatchScheduleWithId = updateBatchSchedule.bind(null, batchId);
  const currentEventScheduleId = batch.event.schedules.find(
    (s) => s.url === batch.scheduleUrl && s.source === batch.scheduleSource,
  )?.id;

  return (
    <div>
      <div className="mb-2 flex gap-1 text-sm text-slate-500">
        <Link href="/admin/events" className="underline">
          Events
        </Link>
        <span>/</span>
        <Link href={`/admin/events/${batch.eventId}`} className="underline">
          {batch.event.name}
        </Link>
        <span>/</span>
        <Link href="/admin/imports" className="underline">
          Imports
        </Link>
      </div>
      <div className="mb-1 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">
          {batch.event.season.label} — {batch.event.name}
        </h1>
        {!isCommitted && (
          <form action={deleteWithId}>
            <SubmitButton
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              pendingText="Deleting…"
            >
              Delete this import
            </SubmitButton>
          </form>
        )}
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Source: {batch.source} · Status: <span className="font-medium">{batch.status}</span>
        {summary && (
          <>
            {" "}
            · {summary.ok ?? 0} ok · {summary.warning ?? 0} warning · {summary.error ?? 0} error
          </>
        )}
      </p>

      {error === "delete-committed" && (
        <p className={errorBannerClass}>Committed imports can&apos;t be deleted.</p>
      )}
      {error === "upload-invalid" && <p className={errorBannerClass}>Select a file to upload.</p>}
      {error === "upload-duplicate" && (
        <p className={errorBannerClass}>A file with that name was already uploaded to this batch.</p>
      )}
      {error === "no-schedule-url" && (
        <p className={errorBannerClass}>
          No schedule URL set for a supported platform on this import — set one below,
          or on the event&apos;s page to use as the default for new imports.
        </p>
      )}
      {error === "bad-schedule-url" && (
        <p className={errorBannerClass}>Could not find an event id in this import&apos;s schedule URL.</p>
      )}
      {error === "fetch-failed" && (
        <p className={errorBannerClass}>Fetching standings failed: {reason ?? "unknown error"}.</p>
      )}
      {error === "commit-blocked" && (
        <p className={errorBannerClass}>Could not commit: {reason ?? "see row statuses below."}</p>
      )}
      {success === "committed" && <p className={successBannerClass}>Import committed.</p>}

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Files</h2>
        <table className={`${tableClass} mb-4`}>
          <thead>
            <tr>
              <th className={thClass}>Filename</th>
              <th className={thClass}>Part</th>
              <th className={thClass}>Rows</th>
              <th className={thClass}>Status</th>
            </tr>
          </thead>
          <tbody>
            {batch.files.map((f) => (
              <tr key={f.id}>
                <td className={tdClass}>{f.filename}</td>
                <td className={tdClass}>{f.partNumber ?? ""}</td>
                <td className={tdClass}>{f.rowCount}</td>
                <td className={tdClass}>
                  {f.status}
                  {f.parseError && <span className="text-red-700"> — {f.parseError}</span>}
                </td>
              </tr>
            ))}
            {batch.files.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={4}>
                  No files uploaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {!isCommitted && (
          <form action={uploadWithId} className="flex items-end gap-3">
            <input type="hidden" name="filter" value={filter ?? ""} />
            <label className="flex flex-col gap-1 text-sm">
              CSV file
              <input
                type="file"
                name="file"
                accept=".csv,text/csv"
                required
                className={fileInputClass}
              />
            </label>
            <SubmitButton className={secondaryButtonClass} pendingText="Uploading…">
              Upload file
            </SubmitButton>
          </form>
        )}

        {!isCommitted && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            {batch.event.schedules.length > 0 ? (
              <form action={updateBatchScheduleWithId} className="mb-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="filter" value={filter ?? ""} />
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  Schedule for this import
                  <select
                    name="eventScheduleId"
                    className={selectClass}
                    defaultValue={currentEventScheduleId ?? ""}
                  >
                    <option value="">No schedule (manual CSV upload)</option>
                    {batch.event.schedules.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label ? `${s.label} — ` : ""}
                        {s.source} — {s.url}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton className={secondaryButtonClass} pendingText="Saving…">
                  Save schedule
                </SubmitButton>
              </form>
            ) : (
              <p className="mb-3 text-sm text-slate-500">
                This event has no schedule links yet —{" "}
                <Link href={`/admin/events/${batch.eventId}`} className="underline">
                  add one on the event&apos;s page
                </Link>{" "}
                to enable Fetch.
              </p>
            )}

            {batch.scheduleUrl && (
              <div className="flex items-center gap-3">
                {batch.scheduleSource === "AES" ? (
                  <form action={fetchAesStandingsWithId}>
                    <input type="hidden" name="filter" value={filter ?? ""} />
                    <SubmitButton className={secondaryButtonClass} pendingText="Fetching…">
                      Fetch standings from AES
                    </SubmitButton>
                  </form>
                ) : batch.scheduleSource === "SPORTWRENCH" ? (
                  <form action={fetchSportwrenchStandingsWithId}>
                    <input type="hidden" name="filter" value={filter ?? ""} />
                    <SubmitButton className={secondaryButtonClass} pendingText="Fetching…">
                      Fetch standings from Sportwrench
                    </SubmitButton>
                  </form>
                ) : (
                  <p className="text-sm text-slate-500">
                    Schedule URL set ({batch.scheduleSource ?? "platform not set"}), but fetching isn&apos;t
                    supported for that platform yet.
                  </p>
                )}
                <span className="truncate text-xs text-slate-400">{batch.scheduleUrl}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {!isCommitted && (
        <section className="mb-8">
          <form action={resolveWithId}>
            <input type="hidden" name="filter" value={filter ?? ""} />
            <SubmitButton
              className={primaryButtonClass}
              disabled={batch.files.length === 0}
              pendingText={isDraft ? "Resolving…" : "Re-resolving…"}
            >
              {isDraft ? "Resolve" : "Re-resolve"}
            </SubmitButton>
          </form>
        </section>
      )}

      {allRows.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-lg font-medium">Preview</h2>
          <div className="mb-3 flex gap-3 text-sm">
            <Link
              href={`/admin/imports/${batchId}`}
              className={!showOnlyAttention ? "font-medium underline" : "text-slate-500 hover:text-slate-900"}
            >
              All ({allRows.length})
            </Link>
            <Link
              href={`/admin/imports/${batchId}?filter=attention`}
              className={showOnlyAttention ? "font-medium underline" : "text-slate-500 hover:text-slate-900"}
            >
              Needs attention ({needsAttentionRows.length})
            </Link>
          </div>
          {!isCommitted && unnamedNewClubCount > 0 && (
            <form action={saveAllSuggestedClubNamesWithId} className="mb-3">
              <input type="hidden" name="filter" value={filter ?? ""} />
              <SubmitButton className={secondaryButtonClass} pendingText="Saving…">
                Save all suggested club names ({unnamedNewClubCount} row{unnamedNewClubCount === 1 ? "" : "s"})
              </SubmitButton>
              <p className="mt-1 text-xs text-slate-500">
                Fills in a best-guess name (or an already-saved one) for every new club
                sharing the same code + region, grouped together. Review and edit any row
                individually afterward if a guess is wrong.
              </p>
            </form>
          )}
          <table className={`${tableClass} mb-4`}>
            <thead>
              <tr>
                <th className={thClass}>#</th>
                <th className={thClass}>Raw label</th>
                <th className={thClass}>Rank</th>
                <th className={thClass}>Division</th>
                <th className={thClass}>Club</th>
                <th className={thClass}>Team</th>
                <th className={thClass}>Status</th>
                {!isCommitted && <th className={thClass}></th>}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td className={tdClass} colSpan={isCommitted ? 7 : 8}>
                    No rows need attention.
                  </td>
                </tr>
              )}
              {visibleRows.map((row) => {
                const overrideDivisionWithIds = overrideRowDivision.bind(null, batchId, row.id);
                const overrideClubWithIds = overrideRowClub.bind(null, batchId, row.id);
                const overrideTeamWithIds = overrideRowTeam.bind(null, batchId, row.id);
                const toggleExcludeWithIds = toggleRowExclude.bind(null, batchId, row.id);

                const matchedDivision = row.matchedDivisionId ? divisionById.get(row.matchedDivisionId) : null;
                const matchedClub = row.matchedClubId ? clubById.get(row.matchedClubId) : null;
                const matchedTeam = row.matchedTeamId ? teamById.get(row.matchedTeamId) : null;
                const ambiguousResolvedClub = row.overrideClubId ? clubById.get(row.overrideClubId) : null;
                const teamOverrideClubId = row.overrideClubId ?? row.matchedClubId;
                const teamOverrideCandidates = teamOverrideClubId ? (teamsByClubId.get(teamOverrideClubId) ?? []) : [];

                return (
                  <tr key={row.id} className={row.excluded ? "opacity-40" : ""}>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      <span
                        className="inline-block max-w-[10rem] truncate align-bottom"
                        title={row.filename}
                      >
                        {row.partNumber ? `Part ${row.partNumber}` : row.filename}
                      </span>{" "}
                      #{row.rowNumber}
                    </td>
                    <td className={tdClass}>
                      {row.ageGroupLabelRaw}
                      {row.tierWasDefaulted && (
                        <span className="ml-1 text-xs text-amber-700">(tier defaulted)</span>
                      )}
                    </td>
                    <td className={tdClass}>{row.parsedRank ?? row.rankRaw}</td>
                    <td className={tdClass}>
                      {row.divisionMatchType === "NEW" ? (
                        <span className="text-xs text-amber-700">
                          NEW: &quot;{row.ageGroupLabelRaw.trim()}&quot; ({row.parsedAgeGroup}u{" "}
                          {row.parsedTierLabel}
                          {row.parsedTierLevel ? ` ${row.parsedTierLevel}` : ""})
                        </span>
                      ) : row.divisionMatchType === "EXISTING" ? (
                        matchedDivision?.name ?? ""
                      ) : (
                        <span className="text-xs text-slate-400">(not yet resolved)</span>
                      )}
                      {!isCommitted && (
                        <form action={overrideDivisionWithIds} className="mt-1 flex gap-1">
                          <input type="hidden" name="filter" value={filter ?? ""} />
                          <select
                            name="overrideDivisionId"
                            className={`${selectClass} text-xs`}
                            defaultValue={row.overrideDivisionId ?? ""}
                          >
                            <option value="">— auto —</option>
                            {divisions.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className={smallSecondaryButtonClass}>
                            Save
                          </button>
                        </form>
                      )}
                    </td>
                    <td className={tdClass}>
                      {row.clubMatchType === "NEW" ? (
                        <span className="text-xs text-amber-700">
                          NEW ({row.parsedClubExternalCode})
                          {row.overrideClubName ? `: ${row.overrideClubName}` : " — needs name"}
                        </span>
                      ) : row.clubMatchType === "AMBIGUOUS" ? (
                        <span
                          className={`text-xs ${row.overrideClubId || row.overrideClubName ? "text-amber-700" : "text-red-700"}`}
                        >
                          AMBIGUOUS ({row.parsedClubExternalCode})
                          {ambiguousResolvedClub
                            ? `: ${ambiguousResolvedClub.name}`
                            : row.overrideClubName
                              ? `: ${row.overrideClubName} (as new club)`
                              : " — pick existing club, or type a name to create as new"}
                        </span>
                      ) : row.clubMatchType === "EXISTING" ? (
                        matchedClub?.name ?? ""
                      ) : (
                        <span className="text-xs text-slate-400">(not yet resolved)</span>
                      )}
                      {/* Full club list is 500+ rows -- only render it for rows that
                          actually need a manual club decision (matches blockingReason's
                          AMBIGUOUS/NEW check), not for every cleanly-matched row. See
                          docs/plan.md Phase 2 postmortem: rendering this select for every
                          row of a real-sized (500+ row) import froze the page. */}
                      {!isCommitted && (row.clubMatchType === "NEW" || row.clubMatchType === "AMBIGUOUS") && (
                        <form action={overrideClubWithIds} className="mt-1 flex flex-wrap items-center gap-1">
                          <input type="hidden" name="filter" value={filter ?? ""} />
                          <select
                            name="overrideClubId"
                            className={`${selectClass} w-28 text-xs`}
                            defaultValue={row.overrideClubId ?? ""}
                          >
                            <option value="">— auto —</option>
                            {clubs.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          <input
                            name="overrideClubName"
                            placeholder="New club name"
                            defaultValue={
                              row.overrideClubName ??
                              (row.clubMatchType === "NEW" && row.teamNameClean
                                ? suggestClubName(row.teamNameClean)
                                : "")
                            }
                            className={`${inputClass} w-28 text-xs`}
                          />
                          <button type="submit" className={smallSecondaryButtonClass}>
                            Save
                          </button>
                        </form>
                      )}
                    </td>
                    <td className={tdClass}>
                      {row.teamMatchType === "NEW" ? (
                        <span className="text-xs text-amber-700">NEW: {row.teamNameClean ?? row.teamNameRaw}</span>
                      ) : row.teamMatchType === "EXISTING" ? (
                        matchedTeam?.name ?? ""
                      ) : (
                        <span className="text-xs text-slate-400">{row.teamNameRaw} (not yet resolved)</span>
                      )}
                      {/* Only render for rows that don't already have a clean
                          existing-team match, and scope the candidate list to the
                          row's matched club (typically a handful of teams) instead of
                          every team in the system (1000+) -- rendering the full list
                          for every unmatched row was the other half of the page-lockup
                          bug this fixes. */}
                      {!isCommitted && row.teamMatchType === "NEW" && teamOverrideCandidates.length > 0 && (
                        <form action={overrideTeamWithIds} className="mt-1 flex gap-1">
                          <input type="hidden" name="filter" value={filter ?? ""} />
                          <select
                            name="overrideTeamId"
                            className={`${selectClass} text-xs`}
                            defaultValue={row.overrideTeamId ?? ""}
                          >
                            <option value="">— auto —</option>
                            {teamOverrideCandidates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} {t.club ? `(${t.club.name})` : ""}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className={smallSecondaryButtonClass}>
                            Save
                          </button>
                        </form>
                      )}
                    </td>
                    <td className={tdClass}>
                      <span className={`font-medium ${STATUS_COLORS[row.status] ?? ""}`}>{row.status}</span>
                      {row.messages.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-xs text-slate-500">
                          {row.messages.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    {!isCommitted && (
                      <td className={tdClass}>
                        <form action={toggleExcludeWithIds}>
                          <input type="hidden" name="filter" value={filter ?? ""} />
                          <button type="submit" className={smallSecondaryButtonClass}>
                            {row.excluded ? "Include" : "Exclude"}
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {!isCommitted && batch.status !== "DRAFT" && (
        <section>
          {blockedCount > 0 && (
            <p className={errorBannerClass}>
              {blockedCount} row(s) need attention before this batch can be committed
              ({errorCount} error, {unnamedNewClubCount} new club needs a name,{" "}
              {ambiguousClubCount} ambiguous club).
            </p>
          )}
          <form action={commitWithId}>
            <input type="hidden" name="filter" value={filter ?? ""} />
            <SubmitButton className={primaryButtonClass} disabled={!canCommit} pendingText="Committing…">
              Commit
            </SubmitButton>
          </form>
        </section>
      )}
    </div>
  );
}

type MatchResultsBatch = NonNullable<Awaited<ReturnType<typeof prisma.importBatch.findUnique>>> & {
  event: {
    name: string;
    season: { label: string };
    schedules: { id: string; url: string; source: ImportSource; label: string | null }[];
  };
};

// MATCH_RESULTS batches don't use the ImportRow-based upload/preview/override
// pipeline above -- match rows resolve deterministically from data the event's
// TEAM_FINISHES import already committed (team codes, division labels), so there's
// no free-text admin judgment call to stage a grid for. Fetch, resolve, and commit
// all happen in one action; this view just shows the trigger and the result. See
// docs/plan.md Phase 5 and src/lib/import/commitMatches.ts.
async function MatchResultsBatchView({
  batch,
  error,
  reason,
  success,
}: {
  batch: MatchResultsBatch;
  error?: string;
  reason?: string;
  success?: string;
}) {
  const isCommitted = batch.status === "COMMITTED";
  const summary = batch.summaryJson as
    | {
        matchesFetched?: number;
        created?: number;
        updated?: number;
        skipped?: number;
        skippedReasonSample?: string[];
      }
    | null;

  const matches = isCommitted
    ? await prisma.match.findMany({
        where: { eventId: batch.eventId },
        include: { division: true, teamA: true, teamB: true, winner: true },
        orderBy: [{ matchDate: "asc" }],
        take: 500,
      })
    : [];

  const fetchAndCommitAesWithId = fetchAndCommitAesMatches.bind(null, batch.id);
  const fetchAndCommitSportwrenchWithId = fetchAndCommitSportwrenchMatches.bind(null, batch.id);
  const deleteWithId = deleteBatch.bind(null, batch.id);
  const updateBatchScheduleWithId = updateBatchSchedule.bind(null, batch.id);
  const currentEventScheduleId = batch.event.schedules.find(
    (s) => s.url === batch.scheduleUrl && s.source === batch.scheduleSource,
  )?.id;

  return (
    <div>
      <div className="mb-2 flex gap-1 text-sm text-slate-500">
        <Link href="/admin/events" className="underline">
          Events
        </Link>
        <span>/</span>
        <Link href={`/admin/events/${batch.eventId}`} className="underline">
          {batch.event.name}
        </Link>
        <span>/</span>
        <Link href="/admin/imports" className="underline">
          Imports
        </Link>
      </div>
      <div className="mb-1 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">
          {batch.event.season.label} — {batch.event.name} (Match Results)
        </h1>
        {!isCommitted && (
          <form action={deleteWithId}>
            <SubmitButton
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              pendingText="Deleting…"
            >
              Delete this import
            </SubmitButton>
          </form>
        )}
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Source: {batch.source} · Status: <span className="font-medium">{batch.status}</span>
        {summary && (
          <>
            {" "}
            · {summary.matchesFetched ?? 0} fetched · {summary.created ?? 0} created ·{" "}
            {summary.updated ?? 0} updated · {summary.skipped ?? 0} skipped
          </>
        )}
      </p>

      {error === "delete-committed" && (
        <p className={errorBannerClass}>Committed imports can&apos;t be deleted.</p>
      )}
      {error === "no-schedule-url" && (
        <p className={errorBannerClass}>
          No schedule URL set for a supported platform on this import — set one below,
          or on the event&apos;s page to use as the default for new imports.
        </p>
      )}
      {error === "bad-schedule-url" && (
        <p className={errorBannerClass}>Could not find an event id in this import&apos;s schedule URL.</p>
      )}
      {error === "fetch-failed" && (
        <p className={errorBannerClass}>Fetching match results failed: {reason ?? "unknown error"}.</p>
      )}
      {success === "committed" && <p className={successBannerClass}>Match results imported.</p>}

      <section className="mb-8">
        {!isCommitted &&
          (batch.event.schedules.length > 0 ? (
            <form action={updateBatchScheduleWithId} className="mb-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Schedule for this import
                <select
                  name="eventScheduleId"
                  className={selectClass}
                  defaultValue={currentEventScheduleId ?? ""}
                >
                  <option value="">No schedule (manual CSV upload)</option>
                  {batch.event.schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label ? `${s.label} — ` : ""}
                      {s.source} — {s.url}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton className={secondaryButtonClass} pendingText="Saving…">
                Save schedule
              </SubmitButton>
            </form>
          ) : (
            <p className="mb-4 text-sm text-slate-500">
              This event has no schedule links yet —{" "}
              <Link href={`/admin/events/${batch.eventId}`} className="underline">
                add one on the event&apos;s page
              </Link>{" "}
              to enable Fetch.
            </p>
          ))}
        {batch.scheduleSource === "AES" && batch.scheduleUrl ? (
          <>
            <form action={fetchAndCommitAesWithId}>
              <SubmitButton className={primaryButtonClass} pendingText="Fetching & importing…">
                {isCommitted ? "Re-fetch match results from AES" : "Fetch match results from AES"}
              </SubmitButton>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              Pulls every completed match for this event from AES and imports it
              immediately (re-running is safe — matches are matched and updated by
              AES&apos;s own match id, not duplicated). Teams/divisions must already
              exist from a Team Finishes import of this same event; unmatched matches
              are skipped, not created as new records — re-running after importing
              more Team Finishes for this event can pick up previously-skipped ones.
            </p>
            <p className="mt-2 truncate text-xs text-slate-400">{batch.scheduleUrl}</p>
          </>
        ) : batch.scheduleSource === "SPORTWRENCH" && batch.scheduleUrl ? (
          <>
            <form action={fetchAndCommitSportwrenchWithId}>
              <SubmitButton className={primaryButtonClass} pendingText="Fetching & importing…">
                {isCommitted ? "Re-fetch match results from Sportwrench" : "Fetch match results from Sportwrench"}
              </SubmitButton>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              Pulls every completed match for this event from Sportwrench and imports
              it immediately (re-running is safe — matches are matched and updated by
              Sportwrench&apos;s own match id, not duplicated). Teams/divisions must
              already exist from a Team Finishes import of this same event; unmatched
              matches are skipped, not created as new records — re-running after
              importing more Team Finishes for this event can pick up
              previously-skipped ones.
            </p>
            <p className="mt-2 truncate text-xs text-slate-400">{batch.scheduleUrl}</p>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            No schedule set for a supported platform on this import — set one above,
            or on the event&apos;s page first.
          </p>
        )}
      </section>

      {isCommitted && (
        <section>
          <h2 className="mb-2 text-lg font-medium">Matches ({matches.length})</h2>
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thClass}>Date</th>
                <th className={thClass}>Division</th>
                <th className={thClass}>Team A</th>
                <th className={thClass}>Team B</th>
                <th className={thClass}>Sets</th>
                <th className={thClass}>Winner</th>
                <th className={thClass}>Stage</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td className={tdClass}>{m.matchDate ? m.matchDate.toISOString().slice(0, 16).replace("T", " ") : ""}</td>
                  <td className={tdClass}>{m.division?.name ?? ""}</td>
                  <td className={tdClass}>{m.teamA?.name ?? ""}</td>
                  <td className={tdClass}>{m.teamB?.name ?? ""}</td>
                  <td className={tdClass}>
                    {m.setsA}-{m.setsB}
                  </td>
                  <td className={tdClass}>{m.winner?.name ?? ""}</td>
                  <td className={tdClass}>{m.stage ?? ""}</td>
                </tr>
              ))}
              {matches.length === 0 && (
                <tr>
                  <td className={tdClass} colSpan={7}>
                    No matches imported.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {isCommitted && summary && (summary.skipped ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-lg font-medium">
            Skipped ({summary.skipped})
          </h2>
          <p className="mb-2 text-sm text-slate-500">
            Most commonly a team that played a match but never received an official
            rank in this event&apos;s Team Finishes import (e.g. a pool-only team that
            didn&apos;t advance) — re-run this fetch after importing/correcting that
            event&apos;s Team Finishes to pick these up.
          </p>
          {summary.skippedReasonSample && summary.skippedReasonSample.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-slate-500">
              {summary.skippedReasonSample.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
              {summary.skipped! > summary.skippedReasonSample.length && (
                <li>…and {summary.skipped! - summary.skippedReasonSample.length} more.</li>
              )}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
