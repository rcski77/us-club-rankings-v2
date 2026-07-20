import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { suggestClubName } from "@/lib/import/clubNameSuggestion";
import { blockingReason } from "@/lib/import/rowBlocking";
import { SubmitButton } from "@/components/SubmitButton";
import {
  uploadImportFile,
  resolveBatch,
  overrideRowDivision,
  overrideRowClub,
  overrideRowTeam,
  toggleRowExclude,
  commitBatch,
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

  // Sequential, not Promise.all -- see docs/dev-environment.md.
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: {
      event: { include: { season: true } },
      files: { include: { rows: { orderBy: { rowNumber: "asc" } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!batch) notFound();

  const divisions = await prisma.division.findMany({
    where: { eventId: batch.eventId },
    orderBy: [{ ageGroup: "desc" }, { name: "asc" }],
  });
  const clubs = await prisma.club.findMany({ orderBy: { name: "asc" } });
  const teams = await prisma.team.findMany({ orderBy: { name: "asc" }, include: { club: true } });

  const divisionById = new Map(divisions.map((d) => [d.id, d]));
  const clubById = new Map(clubs.map((c) => [c.id, c]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  // Scopes the team-override dropdown to the row's own club instead of dumping every
  // team in the system into it -- with real-sized data (1000+ teams) that select was
  // the other half of the page-lockup bug the club-override fix above addresses.
  const teamsByClubId = new Map<string, typeof teams>();
  for (const t of teams) {
    if (!t.clubId) continue;
    const list = teamsByClubId.get(t.clubId) ?? [];
    list.push(t);
    teamsByClubId.set(t.clubId, list);
  }

  const allRows = batch.files.flatMap((f) =>
    f.rows.map((r) => ({ ...r, filename: f.filename, partNumber: f.partNumber })),
  );
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
  const resolveWithId = resolveBatch.bind(null, batchId);
  const commitWithId = commitBatch.bind(null, batchId);
  const saveAllSuggestedClubNamesWithId = saveAllSuggestedClubNames.bind(null, batchId);

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/imports" className="underline">
          Imports
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-semibold">
        {batch.event.season.label} — {batch.event.name}
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        Source: {batch.source} · Status: <span className="font-medium">{batch.status}</span>
        {summary && (
          <>
            {" "}
            · {summary.ok ?? 0} ok · {summary.warning ?? 0} warning · {summary.error ?? 0} error
          </>
        )}
      </p>

      {error === "upload-invalid" && <p className={errorBannerClass}>Select a file to upload.</p>}
      {error === "upload-duplicate" && (
        <p className={errorBannerClass}>A file with that name was already uploaded to this batch.</p>
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
                          NEW: {row.parsedAgeGroup}u {row.parsedTierLabel}
                          {row.parsedTierLevel ? ` ${row.parsedTierLevel}` : ""}
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
