import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { tableClass, thClass, tdClass } from "@/lib/ui";

export default async function PublicEventsPage() {
  const events = await prisma.event.findMany({
    include: { season: true, _count: { select: { divisions: true } } },
    orderBy: { startDate: "desc" },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Events</h1>

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Season</th>
            <th className={thClass}>Dates</th>
            <th className={thClass}>Divisions</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className={tdClass}>
                <Link href={`/rankings/events/${e.id}`} className="text-slate-900 underline">
                  {e.name}
                </Link>
              </td>
              <td className={tdClass}>{e.season.label}</td>
              <td className={tdClass}>
                {e.startDate.toISOString().slice(0, 10)} – {e.endDate.toISOString().slice(0, 10)}
              </td>
              <td className={tdClass}>{e._count.divisions}</td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={4}>
                No events yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
