import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BUCKET_THRESHOLDS } from "@/lib/rating/fieldStrength";
import { tableClass, thClass, tdClass } from "@/lib/ui";

/**
 * The Analysis view (docs/plan.md §2/§5) -- one row per Division in this
 * (season, ageGroup), showing its latest DivisionScoringSnapshot's FSS/percentile/
 * score band/bucket breakdown side by side. Doubles as the suggestion algorithm's
 * justification UI: staff can sanity-check one division's suggestion against every
 * other division's in the same age group, the way the legacy Analysis screen let them
 * eyeball Top5/10/25/.../250 counts across events.
 */
export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ seasonId: string; ageGroup: string }>;
}) {
  const { seasonId, ageGroup: ageGroupParam } = await params;
  const ageGroup = Number(ageGroupParam);

  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season || !ageGroup) notFound();

  const divisions = await prisma.division.findMany({
    where: { ageGroup, event: { seasonId } },
    include: {
      event: true,
      scoringSnapshots: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { suggestedTemplate: true },
      },
    },
    orderBy: [{ event: { startDate: "asc" } }, { name: "asc" }],
  });

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/admin/analysis" className="underline">
          Analysis
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">
        {season.label} · {ageGroup}u Analysis
      </h1>

      <div className="overflow-x-auto">
        <table className={tableClass}>
          <thead>
            <tr>
              <th className={thClass}>Event</th>
              <th className={thClass}>Division</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Teams</th>
              <th className={thClass}>Engine</th>
              <th className={thClass}>FSS</th>
              <th className={thClass}>Elite %</th>
              <th className={thClass}>Pctl</th>
              <th className={thClass}>Band</th>
              {BUCKET_THRESHOLDS.map((t) => (
                <th key={t} className={thClass}>
                  Top {t}
                </th>
              ))}
              <th className={thClass}>Suggested template</th>
            </tr>
          </thead>
          <tbody>
            {divisions.map((division) => {
              const snapshot = division.scoringSnapshots[0];
              const bucketCounts =
                (snapshot?.bucketCounts as Record<string, number> | undefined) ?? {};
              return (
                <tr key={division.id}>
                  <td className={tdClass}>{division.event.name}</td>
                  <td className={tdClass}>
                    <Link
                      href={`/admin/events/${division.eventId}/divisions/${division.id}/scoring`}
                      className="underline"
                    >
                      {division.name}
                    </Link>
                  </td>
                  <td className={tdClass}>{division.scoringStatus}</td>
                  <td className={tdClass}>
                    {snapshot ? `${snapshot.teamCount} / ${snapshot.ratedTeamCount}` : "—"}
                  </td>
                  <td className={tdClass}>{snapshot?.ratingEngineUsed ?? "—"}</td>
                  <td className={tdClass}>
                    {snapshot?.fss !== null && snapshot?.fss !== undefined
                      ? snapshot.ratingEngineUsed === "ELO"
                        ? snapshot.fss.toFixed(0)
                        : snapshot.fss.toFixed(3)
                      : "—"}
                  </td>
                  <td className={tdClass}>
                    {snapshot?.elitePresence !== null && snapshot?.elitePresence !== undefined
                      ? `${snapshot.elitePresence.toFixed(0)}%`
                      : "—"}
                  </td>
                  <td className={tdClass}>
                    {snapshot?.percentile !== null && snapshot?.percentile !== undefined
                      ? `${snapshot.percentile.toFixed(0)}th`
                      : "—"}
                  </td>
                  <td className={tdClass}>{snapshot?.scoreBand ?? "—"}</td>
                  {BUCKET_THRESHOLDS.map((t) => (
                    <td key={t} className={tdClass}>
                      {bucketCounts[String(t)] ?? "—"}
                    </td>
                  ))}
                  <td className={tdClass}>{snapshot?.suggestedTemplate?.name ?? "—"}</td>
                </tr>
              );
            })}
            {divisions.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={10 + BUCKET_THRESHOLDS.length}>
                  No divisions found for this season/age group.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
