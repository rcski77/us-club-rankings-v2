import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { tableClass, thClass, tdClass, primaryButtonClass, successBannerClass } from "@/lib/ui";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const { success } = await searchParams;
  const events = await prisma.event.findMany({
    include: { season: true, _count: { select: { divisions: true } } },
    orderBy: { startDate: "desc" },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Link href="/admin/events/new" className={primaryButtonClass}>
          New event
        </Link>
      </div>

      {success === "event-deleted" && (
        <p className={successBannerClass}>Event deleted.</p>
      )}

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Season</th>
            <th className={thClass}>Dates</th>
            <th className={thClass}>Divisions</th>
            <th className={thClass}>Anchor</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className={tdClass}>
                <Link href={`/admin/events/${e.id}`} prefetch={false} className="text-slate-900 underline">
                  {e.name}
                </Link>
              </td>
              <td className={tdClass}>{e.season.label}</td>
              <td className={tdClass}>
                {e.startDate.toISOString().slice(0, 10)} – {e.endDate.toISOString().slice(0, 10)}
              </td>
              <td className={tdClass}>{e._count.divisions}</td>
              <td className={tdClass}>{e.isAnchor ? "Anchor" : ""}</td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={5}>
                No events yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
