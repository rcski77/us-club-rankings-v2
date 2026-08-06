import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  primaryButtonClass,
  successBannerClass,
  inputClass,
  secondaryButtonClass,
  tableClass,
  thClass,
  tdClass,
  stripedTbodyClass,
} from "@/lib/ui";
import { computeFiveYearClubRankingForYear } from "@/lib/ranking/computeFiveYearClubRanking";
import { FIVE_YEAR_WEIGHTS } from "@/lib/ranking/fiveYearClubRanking";
import { SubmitButton } from "@/components/SubmitButton";

async function recomputeFiveYearRanking(formData: FormData) {
  "use server";
  const endYear = Number(formData.get("endYear"));
  if (!endYear) redirect("/admin/club-rankings/five-year");

  await computeFiveYearClubRankingForYear(endYear);

  redirect(`/admin/club-rankings/five-year?${new URLSearchParams({ endYear: String(endYear), recomputed: "1" })}`);
}

export default async function FiveYearClubRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ endYear?: string; recomputed?: string }>;
}) {
  const { endYear: endYearParam, recomputed } = await searchParams;

  // Offer every endYear that either has ClubAnnualScore data to compute from, or
  // already has a computed result -- whichever is more, defaulting to the latest.
  const [scoreYears, resultYears] = await Promise.all([
    prisma.clubAnnualScore.findMany({ distinct: ["year"], select: { year: true }, orderBy: { year: "desc" } }),
    prisma.clubFiveYearRankingResult.findMany({
      distinct: ["endYear"],
      select: { endYear: true },
      orderBy: { endYear: "desc" },
    }),
  ]);
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
  const years = Array.from({ length: FIVE_YEAR_WEIGHTS.length }, (_, i) => endYear - (FIVE_YEAR_WEIGHTS.length - 1 - i));

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-2xl font-semibold">5-Year Aggregate Club Rankings</h1>
        <Link href="/admin/club-rankings" prefetch={false} className="text-sm text-slate-500 underline">
          ← Back to Club Rankings
        </Link>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Recency-weighted blend of each year&apos;s club-level score ({FIVE_YEAR_WEIGHTS.map((w) => `${w * 100}%`).join(" / ")},
        oldest to newest) — used for NIT invites and housing priority. Sourced from{" "}
        <code className="text-xs">ClubAnnualScore</code> (legacy-imported for 2021-2025, see{" "}
        <code className="text-xs">prisma/importLegacyClubRankings.ts</code>); a missing year contributes 0, not a
        renormalized weight.
      </p>

      {recomputed === "1" && <p className={successBannerClass}>5-year ranking recomputed for {endYear}.</p>}

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
          <SubmitButton className={primaryButtonClass} pendingText="Recomputing…">
            Recompute {endYear - 4}–{endYear}
          </SubmitButton>
        </form>
      </div>

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
                  <Link href={`/admin/clubs/${r.club.id}`} prefetch={false} className="text-slate-900 underline">
                    {r.club.name}
                  </Link>
                </td>
                <td className={tdClass}>{r.totalPoints.toFixed(1)}</td>
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
                      {c.points.toFixed(1)}
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
