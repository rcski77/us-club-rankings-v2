import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { inputClass, tableClass, thClass, tdClass, primaryButtonClass, successBannerClass } from "@/lib/ui";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; q?: string; sort?: string }>;
}) {
  const { success, q, sort } = await searchParams;
  const dateDir = sort === "date_asc" ? "asc" : "desc";

  const events = await prisma.event.findMany({
    where: q
      ? { name: { contains: q, mode: "insensitive" } }
      : undefined,
    include: { season: true, divisions: { select: { scoringStatus: true } } },
    orderBy: { startDate: dateDir },
  });

  const nextDateSort = dateDir === "asc" ? "date_desc" : "date_asc";
  const sortLinkParams = new URLSearchParams();
  if (q) sortLinkParams.set("q", q);
  sortLinkParams.set("sort", nextDateSort);

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

      <form action="/admin/events" method="get" className="mb-4 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name…"
          className={`${inputClass} max-w-sm`}
        />
        {sort && <input type="hidden" name="sort" value={sort} />}
        <button type="submit" className={primaryButtonClass}>
          Search
        </button>
        {q && (
          <Link
            href={sort ? `/admin/events?sort=${sort}` : "/admin/events"}
            className="self-center text-sm text-slate-500 underline"
          >
            Clear
          </Link>
        )}
      </form>

      <table className={tableClass}>
        <thead>
          <tr>
            <th className={thClass}>Name</th>
            <th className={thClass}>Season</th>
            <th className={thClass}>
              <Link href={`/admin/events?${sortLinkParams.toString()}`} className="underline">
                Dates {dateDir === "asc" ? "▲" : "▼"}
              </Link>
            </th>
            <th className={thClass}>Divisions</th>
            <th className={thClass}>Anchor</th>
            <th className={thClass}>Priority</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const confirmed = e.divisions.filter((d) => d.scoringStatus === "CONFIRMED").length;
            return (
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
                <td className={tdClass}>
                  {confirmed}/{e.divisions.length}
                </td>
                <td className={tdClass}>{e.isAnchor ? "Anchor" : ""}</td>
                <td className={tdClass}>{e.isPriority ? "Priority" : ""}</td>
              </tr>
            );
          })}
          {events.length === 0 && (
            <tr>
              <td className={tdClass} colSpan={6}>
                {q ? "No events match your search." : "No events yet."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
