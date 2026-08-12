import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { SeasonFilterSelect } from "@/app/admin/team-rankings/SeasonFilterSelect";

export const metadata: Metadata = { title: "Analysis" };

const AGE_GROUPS = [12, 13, 14, 15, 16, 17, 18];

export default async function AnalysisIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const season = seasons.find((s) => s.id === seasonParam) ?? activeSeason;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Analysis</h1>
      <p className="mb-6 text-sm text-slate-500">
        Strength-of-field breakdown across every division in a season/age group —
        justification for the algorithmic scoring suggestion.
      </p>

      {seasons.length === 0 || !season ? (
        <p className="text-sm text-slate-500">Create a season first (Admin → Seasons).</p>
      ) : (
        <>
          <form method="get" className="mb-6 flex items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Season
              <SeasonFilterSelect seasons={seasons} defaultValue={season.id} />
            </label>
          </form>

          <div className="mb-6 flex gap-1 border-b">
            {AGE_GROUPS.map((a) => (
              <Link
                key={a}
                href={`/admin/analysis/${season.id}/${a}`}
                prefetch={false}
                className="border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
              >
                {a}u
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
