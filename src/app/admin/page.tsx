import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Dashboard" };

async function getStats() {
  const [
    seasonCount,
    clubCount,
    teamCount,
    eventCount,
    divisionCount,
    teamFinishCount,
    matchCount,
    confirmedDivisionCount,
  ] = await Promise.all([
    prisma.season.count(),
    prisma.club.count(),
    prisma.team.count(),
    prisma.event.count(),
    prisma.division.count(),
    prisma.teamFinish.count(),
    prisma.match.count(),
    prisma.division.count({ where: { scoringStatus: "CONFIRMED" } }),
  ]);

  return {
    seasonCount,
    clubCount,
    teamCount,
    eventCount,
    divisionCount,
    teamFinishCount,
    matchCount,
    confirmedDivisionCount,
  };
}

export default async function AdminDashboardPage() {
  const stats = await getStats();

  const tiles = [
    { label: "Seasons", value: stats.seasonCount, color: "slate" as const },
    { label: "Clubs", value: stats.clubCount, color: "blue" as const },
    { label: "Teams", value: stats.teamCount, color: "teal" as const },
    { label: "Events", value: stats.eventCount, color: "purple" as const },
    {
      label: "Divisions",
      value: stats.divisionCount,
      sublabel: `${stats.confirmedDivisionCount} confirmed`,
      color: "amber" as const,
    },
    { label: "Team Finishes", value: stats.teamFinishCount, color: "rose" as const },
    { label: "Matches", value: stats.matchCount, color: "indigo" as const },
  ];

  const tileColorClasses: Record<(typeof tiles)[number]["color"], string> = {
    slate: "border-slate-200 bg-slate-50",
    blue: "border-blue-200 bg-blue-50",
    teal: "border-teal-200 bg-teal-50",
    purple: "border-purple-200 bg-purple-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
    indigo: "border-indigo-200 bg-indigo-50",
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Dashboard</h1>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className={`rounded border p-4 ${tileColorClasses[tile.color]}`}
          >
            <div className="text-2xl font-semibold text-slate-900">
              {tile.value.toLocaleString()}
            </div>
            <div className="text-sm text-slate-600">{tile.label}</div>
            {tile.sublabel && (
              <div className="mt-1 text-xs text-slate-400">{tile.sublabel}</div>
            )}
          </div>
        ))}
      </div>
      <p className="text-slate-600">
        Imports awaiting review, divisions awaiting scoring, and open flags will
        surface here once those modules ship (Phase 1+).
      </p>
    </div>
  );
}
