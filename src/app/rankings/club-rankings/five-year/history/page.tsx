import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { brand } from "@/lib/brand";
import { tableWrapClass, thClass, tdClass, numThClass, numTdClass, tbodyClass } from "@/lib/publicUi";
import { getFiveYearRankingHistory } from "@/lib/ranking/fiveYearRankingHistory";

// No searchParams on this page (unlike its siblings), so Next has no dynamic-API
// signal to infer dynamic rendering from -- without this it gets statically
// prerendered at build time, which hits the DB and fails the Docker build (no DB
// reachable during `npm run build`). Same explicit opt-out /rankings/clubs/page.tsx
// already uses.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Five-Year Rankings History" };

// Same top-100 cap as /rankings/club-rankings/five-year (only the top 100 gets
// published) -- applied against the most recent computed window's rank, since rows
// here are already sorted that way; the admin equivalent stays uncapped for staff QA.
const PUBLISHED_RANK_LIMIT = 100;

export default async function PublicFiveYearRankingHistoryPage() {
  const { endYears, rows } = await getFiveYearRankingHistory();
  const latestYear = endYears[endYears.length - 1];
  const publishedRows = rows.filter((r) => (r.byYear[latestYear]?.rank ?? Infinity) <= PUBLISHED_RANK_LIMIT);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">5-Year Rank History</h1>
      <p className="mb-4 text-sm text-slate-500">
        <Link href="/rankings/club-rankings/five-year" className="underline">
          ← Back to 5-Year Aggregate
        </Link>
      </p>
      <p className="mb-6 text-sm text-slate-500">
        Each club&apos;s rank and total within that year&apos;s own 5-year-window aggregate — not a single-year
        rank. One column per computed window, growing over time as new years are added. Limited to clubs
        currently ranked in the top {PUBLISHED_RANK_LIMIT}.
      </p>

      {endYears.length === 0 ? (
        <p className="text-sm text-slate-500">No 5-year rankings available yet.</p>
      ) : (
        <>
          <div className={tableWrapClass}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ backgroundColor: brand.purple }}>
                  <th className={thClass} rowSpan={2}>
                    Club
                  </th>
                  <th className={thClass} rowSpan={2}>
                    State
                  </th>
                  {endYears.map((y) => (
                    <th key={y} className={numThClass} colSpan={2}>
                      {y - 4}–{y}
                    </th>
                  ))}
                </tr>
                <tr style={{ backgroundColor: brand.purple }}>
                  {endYears.map((y) => (
                    <Fragment key={y}>
                      <th className={numThClass}>Rank</th>
                      <th className={numThClass}>Points</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody className={tbodyClass}>
                {publishedRows.map((r) => (
                  <tr key={r.clubId} className="cursor-pointer">
                    <td className={`${tdClass} relative max-w-[180px] truncate font-medium text-slate-900`}>
                      <Link href={`/rankings/clubs/${r.clubId}`} className="after:absolute after:inset-0 hover:underline">
                        {r.clubName}
                      </Link>
                    </td>
                    <td className={tdClass}>{r.state ?? "—"}</td>
                    {endYears.map((y) => {
                      const cell = r.byYear[y];
                      return (
                        <Fragment key={y}>
                          <td className={numTdClass}>{cell ? cell.rank : <span className="text-slate-400">—</span>}</td>
                          <td className={numTdClass}>
                            {cell ? cell.totalPoints.toFixed(2) : <span className="text-slate-400">—</span>}
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
