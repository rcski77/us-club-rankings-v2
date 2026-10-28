import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { parseRankingGender, rankingGenderParam } from "@/lib/teamGender";

/** Bare /admin/analysis has no age group of its own -- land on 12u by default (same
 * convention as Team Rankings/Club Rankings) rather than making staff pick a tab
 * before seeing anything. */
export default async function AnalysisIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; gender?: string }>;
}) {
  const { season: seasonParam, gender } = await searchParams;
  const seasons = await prisma.season.findMany({ orderBy: { startDate: "desc" } });
  const activeSeason = seasons.find((s) => s.isActive) ?? seasons[0];
  const season = seasons.find((s) => s.id === seasonParam) ?? activeSeason;

  if (!season) {
    return <p className="text-sm text-slate-500">Create a season first (Admin → Seasons).</p>;
  }

  // Girls/boys rides along as a query param (see [seasonId]/[ageGroup]/page.tsx).
  const genderQuery = gender ? `?${new URLSearchParams({ gender: rankingGenderParam(parseRankingGender(gender)) })}` : "";
  redirect(`/admin/analysis/${season.id}/12${genderQuery}`);
}
