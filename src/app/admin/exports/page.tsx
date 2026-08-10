import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { primaryButtonClass, tableClass, thClass, tdClass, stripedTbodyClass } from "@/lib/ui";
import { LEGACY_IMPORT_ALGORITHM_VERSION } from "@/lib/ranking/computeFiveYearClubRanking";

export default async function ExportsPage() {
  // Only years with a computed ClubFiveYearRankingResult are exportable --
  // buildClubRankingsWorkbook() requires it for the 5-Year sheet's totals/rank (see
  // its own gate), so this page surfaces that requirement up front instead of letting
  // staff hit a 400 after clicking "Export."
  const results = await prisma.clubFiveYearRankingResult.findMany({
    distinct: ["endYear"],
    select: { endYear: true, computedAt: true, algorithmVersion: true },
    orderBy: { endYear: "desc" },
  });

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Exports</h1>
      <p className="mb-6 text-sm text-slate-500">
        Downloads the &quot;Rankings for Publish&quot; workbook (5 Year Ranking + 1 Year Ranking sheets) for a
        given end-year window, in the same shape as the legacy hand-built spreadsheet — sourced live from{" "}
        <code className="text-xs">ClubAnnualScore</code> and{" "}
        <code className="text-xs">ClubFiveYearRankingResult</code>.
      </p>

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Window</th>
            <th className={thClass}>5-Year Computed</th>
            <th className={thClass}></th>
          </tr>
        </thead>
        <tbody className={stripedTbodyClass}>
          {results.map((r) => (
            <tr key={r.endYear}>
              <td className={tdClass}>
                {r.endYear - 4}–{r.endYear}
              </td>
              <td className={tdClass}>
                {r.algorithmVersion === LEGACY_IMPORT_ALGORITHM_VERSION
                  ? "Legacy import"
                  : r.computedAt.toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })}
              </td>
              <td className={tdClass}>
                <a
                  href={`/admin/exports/download?${new URLSearchParams({ endYear: String(r.endYear) })}`}
                  className={primaryButtonClass}
                >
                  Export .xlsx
                </a>
              </td>
            </tr>
          ))}
          {results.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={3}>
                No 5-year rankings computed yet —{" "}
                <Link href="/admin/club-rankings/five-year" prefetch={false} className="underline">
                  compute one first
                </Link>
                .
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
