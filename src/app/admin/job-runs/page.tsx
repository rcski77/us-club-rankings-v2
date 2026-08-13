import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { tableClass, thClass, tdClass, stripedTbodyClass, jobRunStatusBadgeClass } from "@/lib/ui";
import type { JobRunKind } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Job Runs" };

const KIND_LABELS: Record<JobRunKind, string> = {
  RATINGS_RECOMPUTE: "Ratings recompute (Colley/Elo/Massey)",
  CLUB_RANKING_RECOMPUTE: "Club ranking recompute",
  ANALYSIS_RECOMPUTE: "Analysis recompute",
  NIGHTLY_RECOMPUTE: "Nightly recompute",
};

// A RUNNING row this old almost certainly belongs to a run whose parent process died
// before it could mark SUCCEEDED/FAILED -- every trigger's own "started" banner tells
// staff to expect a minute or two, so nothing legitimate stays RUNNING this long.
const STALE_RUNNING_MINUTES = 15;

function formatDuration(startedAt: Date, finishedAt: Date | null): string {
  const end = finishedAt ?? new Date();
  const seconds = Math.round((end.getTime() - startedAt.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Read-only diagnostic list of every background recompute run (see JobRun in
 * prisma/schema.prisma) -- the only way to tell whether the last "Recompute ratings" /
 * "Recompute club rankings" / "Run analysis for all divisions" click, or last night's
 * automatic run, actually finished. Those triggers are all fire-and-forget (they run
 * past Cloudflare's ~100s proxy timeout on the homelab host if awaited inline -- see
 * each trigger's own comment), so a failure previously only showed up as a
 * console.error in host logs, and a run whose parent process died mid-flight left no
 * trace at all.
 */
export default async function JobRunsPage() {
  const runs = await prisma.jobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 100,
    include: { season: { select: { label: true } } },
  });

  const staleThreshold = new Date(Date.now() - STALE_RUNNING_MINUTES * 60 * 1000);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Job Runs</h1>
      <p className="mb-6 text-sm text-slate-500">
        Recent background recompute runs (ratings, club rankings, analysis, and the nightly job), most recent
        first. This is diagnostic only — trigger a new run from Team Rankings, Club Rankings, or Analysis.
      </p>

      {runs.length === 0 ? (
        <p className="text-sm text-slate-500">No recompute runs recorded yet.</p>
      ) : (
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>Kind</th>
              <th className={thClass}>Season</th>
              <th className={thClass}>Detail</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Triggered by</th>
              <th className={thClass}>Started</th>
              <th className={thClass}>Finished</th>
              <th className={thClass}>Duration</th>
            </tr>
          </thead>
          <tbody className={stripedTbodyClass}>
            {runs.map((run) => {
              const stale = run.status === "RUNNING" && run.startedAt < staleThreshold;
              return (
                <tr key={run.id}>
                  <td className={tdClass}>{KIND_LABELS[run.kind]}</td>
                  <td className={tdClass}>{run.season.label}</td>
                  <td className={tdClass}>{run.detail ?? "—"}</td>
                  <td className={tdClass}>
                    <span className={jobRunStatusBadgeClass(run.status)}>{run.status}</span>
                    {stale && (
                      <span className="ml-2 text-xs font-medium text-red-700">
                        stuck? — running {STALE_RUNNING_MINUTES}+ min, likely a dead worker process
                      </span>
                    )}
                    {run.status === "FAILED" && run.error && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-red-700 underline">error</summary>
                        <pre className="mt-1 max-w-xl whitespace-pre-wrap break-words text-xs text-red-700">
                          {run.error}
                        </pre>
                      </details>
                    )}
                  </td>
                  <td className={tdClass}>{run.triggeredBy}</td>
                  <td className={tdClass}>{run.startedAt.toLocaleString()}</td>
                  <td className={tdClass}>{run.finishedAt ? run.finishedAt.toLocaleString() : "—"}</td>
                  <td className={tdClass}>{formatDuration(run.startedAt, run.finishedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
