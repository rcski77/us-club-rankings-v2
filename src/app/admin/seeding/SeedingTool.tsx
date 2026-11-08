"use client";

import { useActionState, useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import {
  errorBannerClass,
  fileInputClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
  stripedTbodyClass,
  tableClass,
  tdClass,
  thClass,
} from "@/lib/ui";
import { generateSeedingReport, type SeedingActionState } from "./actions";
import { bandBoundaries, findNearTieClusters, nearTieIndexes, sortForSeeding, type SeedSort } from "@/lib/seeding/bands";
import { buildSeedingCsv } from "@/lib/seeding/exportSeeding";
import { FLAG_LABEL, type SeedingDivisionReport, type SeedingFlag, type SeedingReport } from "@/lib/seeding/types";

const initialState: SeedingActionState = { error: null, report: null };

const FLAG_CLASS: Partial<Record<SeedingFlag, string>> = {
  UNMATCHED: "bg-red-100 text-red-800",
  NO_RATING: "bg-red-100 text-red-800",
  DUPLICATE_CODE: "bg-red-100 text-red-800",
  THIN_DATA: "bg-amber-100 text-amber-800",
  ENGINE_DISAGREEMENT: "bg-amber-100 text-amber-800",
  PRIOR_SEASON_RATING: "bg-amber-100 text-amber-800",
  NEAR_TIE: "bg-blue-100 text-blue-800",
  LINEAGE_MATCH: "bg-slate-200 text-slate-700",
  AGE_MISMATCH: "bg-slate-200 text-slate-700",
};

function FlagBadge({ flag }: { flag: SeedingFlag }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${FLAG_CLASS[flag] ?? "bg-slate-200 text-slate-700"}`}
    >
      {FLAG_LABEL[flag]}
    </span>
  );
}

function fmt(n: number | null, digits = 0): string {
  return n === null ? "—" : n.toFixed(digits);
}

export function SeedingTool({
  events,
  defaultEventId,
}: {
  events: { id: string; label: string }[];
  defaultEventId: string;
}) {
  const [state, action] = useActionState(generateSeedingReport, initialState);
  const [sort, setSort] = useState<SeedSort>("avgRank");
  const [flagFilter, setFlagFilter] = useState<SeedingFlag | "">("");

  return (
    <div>
      <form action={action} className="mb-6 flex flex-wrap items-end gap-3 print:hidden">
        <label className="flex flex-col gap-1 text-sm">
          Event
          <select name="eventId" defaultValue={defaultEventId} className={`${selectClass} max-w-md`}>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Team list (.xlsx)
          <input type="file" name="file" accept=".xlsx" className={fileInputClass} />
        </label>
        <SubmitButton className={primaryButtonClass} pendingText="Building report…">
          Generate report
        </SubmitButton>
      </form>

      {state.error && <p className={errorBannerClass}>{state.error}</p>}

      {state.report && (
        <ReportView
          report={state.report}
          sort={sort}
          onSort={setSort}
          flagFilter={flagFilter}
          onFlagFilter={setFlagFilter}
        />
      )}
    </div>
  );
}

function ReportView({
  report,
  sort,
  onSort,
  flagFilter,
  onFlagFilter,
}: {
  report: SeedingReport;
  sort: SeedSort;
  onSort: (s: SeedSort) => void;
  flagFilter: SeedingFlag | "";
  onFlagFilter: (f: SeedingFlag | "") => void;
}) {
  function download() {
    const blob = new Blob([buildSeedingCsv(report.divisions, sort)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seeding-${report.eventName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-4 rounded border bg-slate-50 p-3 text-sm">
        <p className="font-medium">
          {report.eventName} — {report.seasonLabel} season
        </p>
        <p className="text-slate-600">
          {report.totalRows} teams: {report.matched} matched, {report.lineageMatched} matched via lineage,{" "}
          <strong>{report.unmatched} unmatched</strong>.{" "}
          {report.evidenceCutoff
            ? `Match evidence limited to before ${report.evidenceCutoff.slice(0, 10)}.`
            : "Event has no start date, so all matches this season count."}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm print:hidden">
        <label className="flex items-center gap-2">
          Seed by
          <select value={sort} onChange={(e) => onSort(e.target.value as SeedSort)} className={selectClass}>
            <option value="avgRank">Average power rank</option>
            <option value="nps">NPS season rank</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Show flag
          <select
            value={flagFilter}
            onChange={(e) => onFlagFilter(e.target.value as SeedingFlag | "")}
            className={selectClass}
          >
            <option value="">All teams</option>
            {(Object.keys(FLAG_LABEL) as SeedingFlag[]).map((f) => (
              <option key={f} value={f}>
                {FLAG_LABEL[f]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={download} className={secondaryButtonClass}>
          Download CSV
        </button>
        <button type="button" onClick={() => window.print()} className={secondaryButtonClass}>
          Print
        </button>
      </div>

      {report.divisions.map((d) => (
        <DivisionSection key={d.name} division={d} sort={sort} flagFilter={flagFilter} />
      ))}
    </div>
  );
}

function DivisionSection({
  division,
  sort,
  flagFilter,
}: {
  division: SeedingDivisionReport;
  sort: SeedSort;
  flagFilter: SeedingFlag | "";
}) {
  const [pools, setPools] = useState("");

  const { sorted, ties, boundaries } = useMemo(() => {
    const sorted = sortForSeeding(division.teams, sort);
    const clusters = findNearTieClusters(sorted);
    const poolCount = Number(pools);
    return {
      sorted,
      ties: nearTieIndexes(clusters),
      boundaries:
        Number.isInteger(poolCount) && poolCount >= 2 ? bandBoundaries(sorted.length, poolCount, clusters) : [],
    };
  }, [division.teams, sort, pools]);

  const boundaryAfter = new Map(boundaries.map((b) => [b.afterSeed, b]));
  const unmatched = division.teams.filter((t) => t.matchStatus === "UNMATCHED").length;
  const rated = division.teams.filter((t) => t.avgRank !== null);
  const spread = rated.length ? Math.max(...rated.map((t) => t.avgRank!)) - Math.min(...rated.map((t) => t.avgRank!)) : null;

  return (
    <section className="mb-8 break-inside-avoid-page">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">{division.name}</h2>
        <span className="text-sm text-slate-600">
          {division.teams.length} teams · {unmatched} unmatched · {rated.length} rated
          {spread !== null && ` · avg-rank spread ${spread.toFixed(0)}`}
        </span>
        <label className="ml-auto flex items-center gap-2 text-sm print:hidden">
          Pools
          <input
            type="number"
            min={2}
            max={20}
            value={pools}
            onChange={(e) => setPools(e.target.value)}
            placeholder="—"
            className={`${inputClass} w-20`}
          />
        </label>
      </div>

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Seed</th>
            <th className={thClass}>Team</th>
            <th className={thClass}>Code</th>
            <th className={thClass}>Avg rank</th>
            <th className={thClass} title="Colley / Elo / Massey">
              C / E / M
            </th>
            <th className={thClass}>NPS</th>
            <th className={thClass} title="Matches / distinct opponents before the event">
              Matches
            </th>
            <th className={thClass}>Flags</th>
          </tr>
        </thead>
        <tbody className={stripedTbodyClass}>
          {sorted.flatMap((t, i) => {
            const flags: SeedingFlag[] = ties.has(i) ? [...t.flags, "NEAR_TIE"] : t.flags;
            const hidden = flagFilter !== "" && !flags.includes(flagFilter);
            const boundary = boundaryAfter.get(i + 1); // boundary printed after 1-based seed i + 1
            const rows = [];
            if (!hidden) {
              rows.push(
                <tr key={t.rowNumber}>
                  <td className={tdClass}>{i + 1}</td>
                  <td className={tdClass}>
                    <div className="font-medium">{t.teamName ?? t.fileTeamName}</div>
                    <div className="text-xs text-slate-500">
                      {t.clubName ?? t.fileClubName}
                      {t.teamName && t.fileTeamName && t.teamName !== t.fileTeamName && ` · file: ${t.fileTeamName}`}
                    </div>
                    {t.ratingFromTeam && (
                      <div className="text-xs text-amber-700">
                        Rated from last year: {t.ratingFromTeam}. Players may have changed clubs or teams.
                      </div>
                    )}
                  </td>
                  <td className={`${tdClass} font-mono text-xs`}>{t.code}</td>
                  <td className={tdClass}>{fmt(t.avgRank, 1)}</td>
                  <td className={`${tdClass} text-xs`}>
                    {fmt(t.colleyRank)} / {fmt(t.eloRank)} / {fmt(t.masseyRank)}
                  </td>
                  <td className={tdClass}>
                    {t.npsRank === null ? "—" : `#${t.npsRank}`}
                    {t.npsPoints !== null && <span className="text-xs text-slate-500"> ({t.npsPoints} pts)</span>}
                  </td>
                  <td className={tdClass}>
                    {t.matchesPlayed} / {t.distinctOpponents}
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-wrap gap-1">
                      {flags.map((f) => (
                        <FlagBadge key={f} flag={f} />
                      ))}
                    </div>
                  </td>
                </tr>,
              );
            }
            if (boundary && i + 1 === boundary.afterSeed) {
              rows.push(
                <tr key={`band-${boundary.afterSeed}`}>
                  <td colSpan={8} className="border-y-2 border-slate-400 bg-slate-100 px-3 py-1 text-xs font-medium">
                    Pool boundary after seed {boundary.afterSeed}
                    {boundary.uncertain && " — teams on both sides are a near tie, boundary is a judgment call"}
                  </td>
                </tr>,
              );
            }
            return rows;
          })}
        </tbody>
      </table>
    </section>
  );
}
