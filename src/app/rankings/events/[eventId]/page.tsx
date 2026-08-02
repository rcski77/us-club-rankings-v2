import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { brand } from "@/lib/brand";
import { tableWrapClass, thClass, tdClass, primaryTdClass, numThClass, numTdClass, tbodyClass } from "@/lib/publicUi";

export default async function PublicEventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      season: true,
      divisions: {
        orderBy: [{ ageGroup: "desc" }, { name: "asc" }],
        include: {
          _count: { select: { finishes: true } },
          pointBands: { orderBy: { fromRank: "asc" }, take: 1 },
          scoringSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!event) notFound();

  return (
    <div>
      <div className="mb-2 text-sm text-slate-500">
        <Link href="/rankings/events" className="underline">
          Events
        </Link>
      </div>
      <h1 className="mb-1 text-2xl font-semibold">{event.name}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {event.season.label} · {event.startDate.toISOString().slice(0, 10)} –{" "}
        {event.endDate.toISOString().slice(0, 10)}
        {event.isAnchor && " · Anchor event"}
      </p>

      <div className={tableWrapClass}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: brand.purple }}>
              <th className={thClass}>Division</th>
              <th className={numThClass}>Age</th>
              <th className={thClass}>Tier</th>
              <th className={numThClass}>FSS</th>
              <th className={numThClass}>Max Points</th>
              <th className={numThClass}>Finishes</th>
            </tr>
          </thead>
          <tbody className={tbodyClass}>
            {event.divisions.map((d) => (
              <tr key={d.id} className="relative cursor-pointer">
                <td className={primaryTdClass}>
                  <Link
                    href={`/rankings/events/${event.id}/divisions/${d.id}`}
                    className="after:absolute after:inset-0 hover:underline"
                  >
                    {d.name}
                  </Link>
                </td>
                <td className={numTdClass}>{d.ageGroup}u</td>
                <td className={`${tdClass} text-slate-500`}>
                  {d.tierLabel}
                  {d.tierLevel ? ` ${d.tierLevel}` : ""}
                </td>
                <td className={numTdClass}>
                  {(() => {
                    const snapshot = d.scoringSnapshots[0];
                    if (!snapshot || snapshot.fss === null) return "—";
                    return snapshot.ratingEngineUsed === "ELO" ? snapshot.fss.toFixed(0) : snapshot.fss.toFixed(3);
                  })()}
                </td>
                <td className={`${numTdClass} font-semibold`} style={{ color: brand.purple }}>
                  {d.pointBands[0]?.points ?? "—"}
                </td>
                <td className={numTdClass}>{d._count.finishes}</td>
              </tr>
            ))}
            {event.divisions.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={6}>
                  No divisions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
