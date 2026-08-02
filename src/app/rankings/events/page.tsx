import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { brand } from "@/lib/brand";
import { tableWrapClass, thClass, tdClass, numThClass, numTdClass, tbodyClass } from "@/lib/publicUi";
import { SeasonFilterSelect } from "./SeasonFilterSelect";
import { DEFAULT_PAGE_SIZE, Pagination, parsePage } from "../Pagination";

function TeamsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="inline-block h-3.5 w-3.5">
      <circle cx="7" cy="6.5" r="2.5" />
      <path d="M2.5 16c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5" />
      <circle cx="14" cy="7" r="2" opacity="0.6" />
      <path d="M12.5 11.7c1.9.3 3.3 1.8 3.3 4.3" opacity="0.6" />
    </svg>
  );
}

function MatchesIcon() {
  // A hand-drawn seam pattern reads as a volleyball at normal icon sizes, but at this
  // table's ~14px it collapses into an illegible asterisk -- the emoji is purpose-built
  // to stay recognizable at tiny sizes, so it wins here despite the inconsistency with
  // the other hand-drawn icons on this row.
  return <span className="text-sm leading-none">🏐</span>;
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="inline-block h-3.5 w-3.5">
      <path d="M10 18s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10Z" />
      <circle cx="10" cy="8" r="2.2" />
    </svg>
  );
}

function DateIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="inline-block h-3.5 w-3.5">
      <rect x="3" y="4" width="14" height="13" rx="1.5" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" />
    </svg>
  );
}

export default async function PublicEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; page?: string }>;
}) {
  const { season: seasonParam, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);

  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const selectedSeasonId = seasonParam === "all" ? "all" : seasonParam && seasons.some((s) => s.id === seasonParam) ? seasonParam : activeSeason?.id ?? "all";

  const eventsWhere = selectedSeasonId === "all" ? {} : { seasonId: selectedSeasonId };
  // Sequential awaits (not Promise.all) -- see docs/dev-environment.md.
  const totalCount = await prisma.event.count({ where: eventsWhere });
  const events = await prisma.event.findMany({
    where: eventsWhere,
    include: {
      _count: { select: { divisions: true, matches: true } },
      divisions: { select: { _count: { select: { finishes: true } } } },
    },
    orderBy: { startDate: "desc" },
    skip: (page - 1) * DEFAULT_PAGE_SIZE,
    take: DEFAULT_PAGE_SIZE,
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Events</h1>
        <form method="get">
          <SeasonFilterSelect seasons={seasons} defaultValue={selectedSeasonId} />
        </form>
      </div>

      <div className={tableWrapClass}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: brand.purple }}>
              <th className={thClass}>Tournament</th>
              <th className={numThClass}>Teams</th>
              <th className={numThClass}>Matches</th>
              <th className={thClass}>Location</th>
              <th className={thClass}>Date</th>
            </tr>
          </thead>
          <tbody className={tbodyClass}>
            {events.map((e) => {
              const teamCount = e.divisions.reduce((sum, d) => sum + d._count.finishes, 0);
              const location = [e.city, e.state].filter(Boolean).join(", ");
              return (
                <tr key={e.id} className="relative cursor-pointer">
                  <td className="px-4 py-3 text-sm">
                    <Link
                      href={`/rankings/events/${e.id}`}
                      className="font-medium text-slate-900 after:absolute after:inset-0 hover:underline"
                    >
                      {e.name}
                    </Link>
                    <div className="mt-1 text-xs text-slate-400">
                      {e._count.divisions} division{e._count.divisions === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td className={numTdClass}>
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <TeamsIcon />
                      {teamCount.toLocaleString()}
                    </span>
                  </td>
                  <td className={numTdClass}>
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <MatchesIcon />
                      {e._count.matches.toLocaleString()}
                    </span>
                  </td>
                  <td className={`${tdClass} text-slate-500`}>
                    {location ? (
                      <span className="inline-flex items-center gap-1">
                        <LocationIcon />
                        {location}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`${tdClass} text-slate-500`}>
                    <span className="inline-flex items-center gap-1">
                      <DateIcon />
                      {e.startDate.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </td>
                </tr>
              );
            })}
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
      <Pagination
        page={page}
        totalCount={totalCount}
        pageSize={DEFAULT_PAGE_SIZE}
        basePath="/rankings/events"
        baseParams={new URLSearchParams({ season: selectedSeasonId })}
      />
    </div>
  );
}
