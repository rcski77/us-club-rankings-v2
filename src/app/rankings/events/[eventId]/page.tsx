import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { tableClass, thClass, tdClass, scoringStatusBadgeClass } from "@/lib/ui";

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

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Division</th>
            <th className={thClass}>Age</th>
            <th className={thClass}>Tier</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Max points</th>
            <th className={thClass}>Finishes</th>
          </tr>
        </thead>
        <tbody>
          {event.divisions.map((d) => (
            <tr key={d.id}>
              <td className={tdClass}>
                <Link
                  href={`/rankings/events/${event.id}/divisions/${d.id}`}
                  className="text-slate-900 underline"
                >
                  {d.name}
                </Link>
              </td>
              <td className={tdClass}>{d.ageGroup}u</td>
              <td className={tdClass}>
                {d.tierLabel}
                {d.tierLevel ? ` ${d.tierLevel}` : ""}
              </td>
              <td className={tdClass}>
                <span className={scoringStatusBadgeClass(d.scoringStatus)}>{d.scoringStatus}</span>
              </td>
              <td className={tdClass}>{d.pointBands[0]?.points ?? "—"}</td>
              <td className={tdClass}>{d._count.finishes}</td>
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
  );
}
