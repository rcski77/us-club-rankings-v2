import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

/** Bare /admin/analysis has no age group of its own -- land on 12u by default (same
 * convention as Team Rankings/Club Rankings) rather than making staff pick a tab
 * before seeing anything. */
export default async function AnalysisIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const season = seasons.find((s) => s.id === seasonParam) ?? activeSeason;

  if (!season) {
    return <p className="text-sm text-slate-500">Create a season first (Admin → Seasons).</p>;
  }

  redirect(`/admin/analysis/${season.id}/12`);
}
