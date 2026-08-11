import { Fragment } from "react";
import Link from "next/link";
import { tableClass, thClass, tdClass, stripedTbodyClass } from "@/lib/ui";
import { getFiveYearRankingHistory } from "@/lib/ranking/fiveYearRankingHistory";
import { Breadcrumbs } from "@/components/Breadcrumbs";

export default async function FiveYearRankingHistoryPage() {
  const { endYears, rows } = await getFiveYearRankingHistory();

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Club Rankings", href: "/admin/club-rankings" },
          { label: "5-Year Aggregate", href: "/admin/club-rankings/five-year" },
          { label: "Rank History" },
        ]}
      />
      <h1 className="mb-6 text-2xl font-semibold">5-Year Rank History</h1>
      <p className="mb-6 text-sm text-slate-500">
        Each club&apos;s rank and total within *that year&apos;s own* 5-year-window aggregate — not a single-year
        rank. One column per computed window; grows as future years get synced (see 5-Year Aggregate&apos;s
        &quot;Add a new year&quot; section).
      </p>

      {endYears.length === 0 ? (
        <p className="text-sm text-slate-500">
          No 5-year rankings computed yet — go to{" "}
          <Link href="/admin/club-rankings/five-year" prefetch={false} className="underline">
            5-Year Aggregate
          </Link>{" "}
          and recompute at least one window.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thClass} rowSpan={2}>
                  Club Code
                </th>
                <th className={thClass} rowSpan={2}>
                  Club Name
                </th>
                <th className={thClass} rowSpan={2}>
                  State
                </th>
                {endYears.map((y) => (
                  <th key={y} className={`${thClass} text-center`} colSpan={2}>
                    {y - 4}–{y}
                  </th>
                ))}
              </tr>
              <tr>
                {endYears.map((y) => (
                  <Fragment key={y}>
                    <th className={thClass}>Rank</th>
                    <th className={thClass}>Points</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody className={stripedTbodyClass}>
              {rows.map((r) => (
                <tr key={r.clubId}>
                  <td className={tdClass}>{r.clubCode ?? "—"}</td>
                  <td className={tdClass}>
                    <Link
                      href={`/admin/clubs/${r.clubId}?from=five-year`}
                      prefetch={false}
                      className="text-slate-900 underline"
                    >
                      {r.clubName}
                    </Link>
                  </td>
                  <td className={tdClass}>{r.state ?? "—"}</td>
                  {endYears.map((y) => {
                    const cell = r.byYear[y];
                    return (
                      <Fragment key={y}>
                        <td className={tdClass}>
                          {cell ? cell.rank : <span className="text-slate-400">—</span>}
                        </td>
                        <td className={tdClass}>
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
      )}
    </div>
  );
}
