import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAttentionItems, getFreshness, getGenderSplits, type AttentionItem } from "@/lib/adminDashboard";
import { tableClass, thClass, tdClass, stripedTbodyClass, jobRunStatusBadgeClass } from "@/lib/ui";

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

const ENGINE_LABEL = { COLLEY: "Colley", ELO: "Elo", MASSEY: "Massey" } as const;

const TONE_DOT_CLASS: Record<AttentionItem["tone"], string> = {
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-slate-400",
};

function formatWhen(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function splitLabel(counts: { GIRLS: number; BOYS: number }): string {
  return `${counts.GIRLS.toLocaleString()} girls · ${counts.BOYS.toLocaleString()} boys`;
}

export default async function AdminDashboardPage() {
  const activeSeason = await prisma.season.findFirst({
    where: { isActive: true },
    select: { id: true, label: true },
  });
  // Every block below is independent of the others -- see the Promise.all convention.
  const [stats, splits, attention, freshness] = await Promise.all([
    getStats(),
    getGenderSplits(activeSeason?.id),
    getAttentionItems(activeSeason?.id),
    getFreshness(activeSeason?.id),
  ]);

  const tiles = [
    { label: "Seasons", value: stats.seasonCount, color: "slate" as const },
    { label: "Clubs", value: stats.clubCount, color: "blue" as const },
    { label: "Teams", value: stats.teamCount, sublabel: splitLabel(splits.teams), color: "teal" as const },
    { label: "Events", value: stats.eventCount, color: "purple" as const },
    {
      label: "Divisions",
      value: stats.divisionCount,
      sublabel: `${splitLabel(splits.divisions)} · ${stats.confirmedDivisionCount} confirmed`,
      color: "amber" as const,
    },
    { label: "Team Finishes", value: stats.teamFinishCount, color: "rose" as const },
    {
      label: "Matches",
      value: stats.matchCount,
      sublabel: splitLabel({ GIRLS: stats.matchCount - splits.boysMatches, BOYS: splits.boysMatches }),
      color: "indigo" as const,
    },
    {
      label: "Power-rated teams",
      value: splits.powerRatedTeams.GIRLS + splits.powerRatedTeams.BOYS,
      sublabel: `${splitLabel(splits.powerRatedTeams)}${activeSeason ? ` · ${activeSeason.label}` : ""}`,
      color: "emerald" as const,
    },
  ];

  const tileColorClasses: Record<(typeof tiles)[number]["color"], string> = {
    slate: "border-slate-200 bg-slate-50",
    blue: "border-blue-200 bg-blue-50",
    teal: "border-teal-200 bg-teal-50",
    purple: "border-purple-200 bg-purple-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
    indigo: "border-indigo-200 bg-indigo-50",
    emerald: "border-emerald-200 bg-emerald-50",
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Dashboard</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Totals</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className={`rounded border p-4 ${tileColorClasses[tile.color]}`}>
              <div className="text-2xl font-semibold text-slate-900">{tile.value.toLocaleString()}</div>
              <div className="text-sm text-slate-600">{tile.label}</div>
              {tile.sublabel && <div className="mt-1 text-xs text-slate-500">{tile.sublabel}</div>}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">Needs attention</h2>
        {attention.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing needs attention right now.</p>
        ) : (
          <ul className="flex max-w-3xl flex-col divide-y rounded border">
            {attention.map((item) => (
              <li key={item.label} className="flex items-start gap-3 px-4 py-2 text-sm">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT_CLASS[item.tone]}`} aria-hidden />
                <span className="w-12 shrink-0 font-semibold tabular-nums text-slate-900">
                  {item.count.toLocaleString()}
                </span>
                <span className="flex-1">
                  {item.href ? (
                    <Link href={item.href} prefetch={false} className="text-slate-900 underline">
                      {item.label}
                    </Link>
                  ) : (
                    <span className="text-slate-900">{item.label}</span>
                  )}
                  {item.hint && <span className="block text-xs text-slate-500">{item.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-medium">
          Last computed{activeSeason ? <span className="text-slate-500"> · {activeSeason.label}</span> : null}
        </h2>
        <table className={`${tableClass} max-w-3xl`}>
          <thead>
            <tr>
              <th className={thClass}>Ranking</th>
              <th className={thClass}>Girls</th>
              <th className={thClass}>Boys</th>
            </tr>
          </thead>
          <tbody className={stripedTbodyClass}>
            {freshness.engines.map((e) => (
              <tr key={e.engine}>
                <td className={tdClass}>{ENGINE_LABEL[e.engine]} (Power)</td>
                <td className={tdClass}>{formatWhen(e.GIRLS)}</td>
                <td className={tdClass}>{formatWhen(e.BOYS)}</td>
              </tr>
            ))}
            <tr>
              <td className={tdClass}>NPS (points)</td>
              <td className={tdClass}>{formatWhen(freshness.nps.GIRLS)}</td>
              <td className={tdClass}>{formatWhen(freshness.nps.BOYS)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-sm text-slate-600">
          Last nightly recompute:{" "}
          {freshness.lastNightly ? (
            <>
              <span className={jobRunStatusBadgeClass(freshness.lastNightly.status)}>
                {freshness.lastNightly.status}
              </span>{" "}
              {formatWhen(freshness.lastNightly.finishedAt ?? freshness.lastNightly.startedAt)} ·{" "}
              <Link href="/admin/job-runs" prefetch={false} className="underline">
                Job Runs
              </Link>
            </>
          ) : (
            "never"
          )}
        </p>
      </section>
    </div>
  );
}
