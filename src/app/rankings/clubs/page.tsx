import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { brand } from "@/lib/brand";
import { tableWrapClass, thClass, tdClass, primaryTdClass, numThClass, numTdClass, tbodyClass } from "@/lib/publicUi";
import { DEFAULT_PAGE_SIZE, Pagination, parsePage } from "../Pagination";

export const dynamic = "force-dynamic";

export default async function PublicClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);

  // Sequential awaits (not Promise.all) -- see docs/dev-environment.md.
  const totalCount = await prisma.club.count();
  const clubs = await prisma.club.findMany({
    include: { region: true, _count: { select: { teams: true } } },
    orderBy: { name: "asc" },
    skip: (page - 1) * DEFAULT_PAGE_SIZE,
    take: DEFAULT_PAGE_SIZE,
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Clubs</h1>

      <div className={tableWrapClass}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: brand.purple }}>
              <th className={thClass}>Name</th>
              <th className={numThClass}>Region</th>
              <th className={thClass}>City/State</th>
              <th className={numThClass}>Teams</th>
            </tr>
          </thead>
          <tbody className={tbodyClass}>
            {clubs.map((c) => (
              <tr key={c.id} className="relative cursor-pointer">
                <td className={primaryTdClass}>
                  <Link href={`/rankings/clubs/${c.id}`} className="after:absolute after:inset-0 hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className={numTdClass}>{c.region?.code ?? ""}</td>
                <td className={`${tdClass} text-slate-500`}>{[c.city, c.state].filter(Boolean).join(", ")}</td>
                <td className={`${numTdClass} font-semibold`} style={{ color: brand.purple }}>
                  {c._count.teams}
                </td>
              </tr>
            ))}
            {clubs.length === 0 && (
              <tr>
                <td className={tdClass} colSpan={4}>
                  No clubs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalCount={totalCount} pageSize={DEFAULT_PAGE_SIZE} basePath="/rankings/clubs" baseParams={new URLSearchParams()} />
    </div>
  );
}
