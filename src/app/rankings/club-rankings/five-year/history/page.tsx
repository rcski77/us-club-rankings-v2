import { Fragment } from "react";
import Link from "next/link";
import { brand } from "@/lib/brand";
import { tableWrapClass, thClass, tdClass, numThClass, numTdClass, tbodyClass } from "@/lib/publicUi";
import { getFiveYearRankingHistory } from "@/lib/ranking/fiveYearRankingHistory";
import { DEFAULT_PAGE_SIZE, Pagination, parsePage } from "../../../Pagination";

export default async function PublicFiveYearRankingHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);

  const { endYears, rows } = await getFiveYearRankingHistory();
  const totalCount = rows.length;
  const pageRows = rows.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE);

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
        rank. One column per computed window, growing over time as new years are added.
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
                {pageRows.map((r) => (
                  <tr key={r.clubId} className="relative cursor-pointer">
                    <td className={`${tdClass} max-w-[180px] truncate font-medium text-slate-900`}>
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
          <Pagination
            page={page}
            totalCount={totalCount}
            pageSize={DEFAULT_PAGE_SIZE}
            basePath="/rankings/club-rankings/five-year/history"
            baseParams={new URLSearchParams()}
          />
        </>
      )}
    </div>
  );
}
