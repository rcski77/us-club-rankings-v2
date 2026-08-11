import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  primaryButtonClass,
  successBannerClass,
  errorBannerClass,
  inputClass,
  secondaryButtonClass,
  tableClass,
  thClass,
  tdClass,
  stripedTbodyClass,
} from "@/lib/ui";
import {
  computeFiveYearClubRankingForYear,
  syncClubAnnualScoreFromSeason,
  LEGACY_IMPORT_ALGORITHM_VERSION,
} from "@/lib/ranking/computeFiveYearClubRanking";
import { FIVE_YEAR_WEIGHTS } from "@/lib/ranking/fiveYearClubRanking";
import { SubmitButton } from "@/components/SubmitButton";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { ClubRankingSource } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Five-Year Club Rankings" };

const SYNC_SOURCES = [
  { value: "COMBINED", label: "Combined" },
  { value: "NPS", label: "NPS" },
] as const;

async function recomputeFiveYearRanking(formData: FormData) {
  "use server";
  const endYear = Number(formData.get("endYear"));
  if (!endYear) redirect("/admin/club-rankings/five-year");

  const result = await computeFiveYearClubRankingForYear(endYear);
  if (!result.ok) {
    redirect(
      `/admin/club-rankings/five-year?${new URLSearchParams({ endYear: String(endYear), error: "legacy_window" })}`,
    );
  }

  redirect(`/admin/club-rankings/five-year?${new URLSearchParams({ endYear: String(endYear), recomputed: "1" })}`);
}

async function syncSeason(formData: FormData) {
  "use server";
  const seasonId = String(formData.get("seasonId") ?? "");
  const source = String(formData.get("source") ?? "COMBINED") as ClubRankingSource;
  if (!seasonId) redirect("/admin/club-rankings/five-year");

  const { year } = await syncClubAnnualScoreFromSeason(seasonId, source);

  redirect(
    `/admin/club-rankings/five-year?${new URLSearchParams({ endYear: String(year), synced: "1", syncedSource: source })}`,
  );
}

export default async function FiveYearClubRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    endYear?: string;
    recomputed?: string;
    synced?: string;
    syncedSource?: string;
    error?: string;
  }>;
}) {
  const { endYear: endYearParam, recomputed, synced, syncedSource, error } = await searchParams;

  // Offer every endYear that either has ClubAnnualScore data to compute from, or
  // already has a computed result -- whichever is more, defaulting to the latest.
  const [scoreYears, resultYears, seasons] = await Promise.all([
    prisma.clubAnnualScore.findMany({ distinct: ["year"], select: { year: true }, orderBy: { year: "desc" } }),
    prisma.clubFiveYearRankingResult.findMany({
      distinct: ["endYear"],
      select: { endYear: true },
      orderBy: { endYear: "desc" },
    }),
    // Just to build the "back to NPS/Combined" tab links below with the same
    // default-season logic /admin/club-rankings itself uses -- no season-scoped data
    // is queried on this page otherwise, since ClubAnnualScore isn't season-scoped.
    prisma.season.findMany({ orderBy: { startDate: "desc" } }),
  ]);
  const defaultSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const availableYears = Array.from(
    new Set([...scoreYears.map((y) => y.year), ...resultYears.map((y) => y.endYear)]),
  ).sort((a, b) => b - a);

  const endYear = Number(endYearParam) || availableYears[0] || new Date().getFullYear();

  const results = await prisma.clubFiveYearRankingResult.findMany({
    where: { endYear },
    include: { club: true, contributions: { orderBy: { year: "asc" } } },
    orderBy: { rank: "asc" },
  });
  const computedAt = results[0]?.computedAt;
  const isLegacyWindow = results.some((r) => r.algorithmVersion === LEGACY_IMPORT_ALGORITHM_VERSION);
  const years = Array.from({ length: FIVE_YEAR_WEIGHTS.length }, (_, i) => endYear - (FIVE_YEAR_WEIGHTS.length - 1 - i));

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Club Rankings", href: "/admin/club-rankings" },
          { label: "5-Year Aggregate" },
        ]}
      />
      <h1 className="mb-2 text-2xl font-semibold">5-Year Aggregate Club Rankings</h1>

      {/* Same tab row as /admin/club-rankings, so the two views read as one surface --
          NPS/Combined link back with whatever season is currently active/default,
          since this page itself has no season selector of its own to preserve. */}
      {defaultSeason && (
        <div className="mb-4 flex gap-1 border-b">
          <Link
            href={`/admin/club-rankings?${new URLSearchParams({ season: defaultSeason.id, source: "NPS" })}`}
            prefetch={false}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
          >
            NPS
          </Link>
          <Link
            href={`/admin/club-rankings?${new URLSearchParams({ season: defaultSeason.id, source: "COMBINED" })}`}
            prefetch={false}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
          >
            Combined
          </Link>
          <span className="border-b-2 border-slate-900 px-3 py-2 text-sm font-medium text-slate-900">
            5-Year Aggregate
          </span>
        </div>
      )}

      <p className="mb-6 text-sm text-slate-500">
        Recency-weighted blend of each year&apos;s club-level score ({FIVE_YEAR_WEIGHTS.map((w) => `${w * 100}%`).join(" / ")},
        oldest to newest) — used for NIT invites and housing priority. Sourced from{" "}
        <code className="text-xs">ClubAnnualScore</code> (legacy-imported for 2021-2025, see{" "}
        <code className="text-xs">prisma/importLegacyClubRankings.ts</code>); a missing year contributes 0, not a
        renormalized weight.
      </p>

      <p className="mb-6 text-sm">
        <Link href="/admin/club-rankings/five-year/history" prefetch={false} className="text-slate-500 underline">
          View 5-year rank history across every computed window →
        </Link>
      </p>
      <p className="mb-6 text-sm">
        <Link href="/admin/exports" prefetch={false} className="text-slate-500 underline">
          Export the published rankings workbook (.xlsx) →
        </Link>
      </p>

      {error === "legacy_window" && (
        <p className={errorBannerClass}>
          {endYear} is a legacy-imported window (from the workbook&apos;s &quot;5 Year to Publish&quot; sheet) —
          there&apos;s no underlying 2017-2020 data in this app to recompute it from, so recompute is disabled to
          avoid overwriting it with an incomplete result.
        </p>
      )}
      {recomputed === "1" && <p className={successBannerClass}>5-year ranking recomputed for {endYear}.</p>}
      {synced === "1" && (
        <p className={successBannerClass}>
          Season synced into {endYear}&apos;s annual scores using {syncedSource === "NPS" ? "NPS" : "Combined"}{" "}
          rankings — click &quot;Recompute&quot; below to fold it into the 5-year total.
        </p>
      )}

      <div className="mb-6 flex items-end gap-3">
        <form method="get" className="flex items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Window ending in
            <select name="endYear" defaultValue={endYear} className={inputClass}>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y} ({y - 4}–{y})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={secondaryButtonClass}>
            View
          </button>
        </form>

        <form action={recomputeFiveYearRanking}>
          <input type="hidden" name="endYear" value={endYear} />
          <SubmitButton className={primaryButtonClass} pendingText="Recomputing…" disabled={isLegacyWindow}>
            Recompute {endYear - 4}–{endYear}
          </SubmitButton>
        </form>
        {isLegacyWindow && (
          <p className="pb-2 text-xs text-slate-500">
            Legacy-imported window — see &quot;5 Year to Publish&quot; in the source workbook. Not recomputable
            (no underlying 2017-2020 data in this app).
          </p>
        )}
      </div>

      {seasons.length > 0 && (
        <details className="mb-6 rounded border p-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">
            Add a new year — sync a season&apos;s club rankings
          </summary>
          <p className="mt-2 mb-3 text-xs text-slate-500">
            2021-2025 came from the legacy workbook import (only one version of those exists, so they&apos;re
            never re-synced here); a real season computed by this app folds in the same way — syncing writes
            that season&apos;s chosen ranking&apos;s totals into <code className="text-xs">ClubAnnualScore</code>{" "}
            under the season&apos;s ending year (e.g. &quot;2025-2026&quot; → 2026), making that year selectable
            above. Run Club Rankings&apos; own recompute (for whichever source you pick below) first if it looks
            stale.
          </p>
          <form action={syncSeason} className="flex items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Season
              <select name="seasonId" defaultValue={defaultSeason?.id} className={inputClass}>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} (ends {s.endDate.getFullYear()})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Ranking
              <select name="source" defaultValue="COMBINED" className={inputClass}>
                {SYNC_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton className={secondaryButtonClass} pendingText="Syncing…">
              Sync season
            </SubmitButton>
          </form>
        </details>
      )}

      {computedAt && (
        <p className="mb-4 text-sm text-slate-500">
          Computed{" "}
          {computedAt.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}
        </p>
      )}

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Rank</th>
            <th className={thClass}>Club</th>
            <th className={thClass}>5-Year Total</th>
            {years.map((y, i) => (
              <th key={y} className={thClass}>
                {y} ({FIVE_YEAR_WEIGHTS[i] * 100}%)
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={stripedTbodyClass}>
          {results.map((r) => {
            const byYear = new Map(r.contributions.map((c) => [c.year, c]));
            return (
              <tr key={r.id}>
                <td className={tdClass}>{r.rank}</td>
                <td className={tdClass}>
                  <Link
                    href={`/admin/clubs/${r.club.id}?from=five-year`}
                    prefetch={false}
                    className="text-slate-900 underline"
                  >
                    {r.club.name}
                  </Link>
                </td>
                <td className={tdClass}>{r.totalPoints.toFixed(2)}</td>
                {years.map((y) => {
                  const c = byYear.get(y);
                  if (!c || !c.present) {
                    return (
                      <td key={y} className={`${tdClass} text-slate-400`}>
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={y} className={tdClass}>
                      {c.points.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {results.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={3 + years.length}>
                No 5-year ranking computed yet for {endYear - 4}–{endYear} — click &quot;Recompute&quot; above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
