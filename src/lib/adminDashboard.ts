import { prisma } from "@/lib/prisma";
import type { JobRunStatus, RatingEngine } from "@/generated/prisma/enums";
import { findMislabeledDivisions } from "@/lib/divisionGenderAudit";
import { NIGHTLY_STALE_HOURS, STALE_RUNNING_MINUTES } from "@/lib/jobs/jobHealth";
import type { RankingGender } from "@/lib/teamGender";

export type GenderCounts = Record<RankingGender, number>;

export type AttentionItem = {
  label: string;
  count: number;
  /** What to do about it, when there's no page that does it for you. */
  hint?: string;
  href?: string;
  tone: "error" | "warning" | "info";
};

/** Girls/boys counts for the dashboard tiles. COED divisions count as girls, same
 * bucket rule as everywhere else (teamGender.ts's partitionGenderForDivision). */
export async function getGenderSplits(activeSeasonId: string | undefined) {
  const [teamGroups, divisionGroups, boysMatches, ratedTeams] = await Promise.all([
    prisma.team.groupBy({ by: ["gender"], _count: { _all: true } }),
    prisma.division.groupBy({ by: ["gender"], _count: { _all: true } }),
    // A match's gender is its teams' -- cross-gender matches are rare exhibitions, so
    // teamA alone is good enough for a dashboard count.
    prisma.match.count({ where: { teamA: { gender: "BOYS" } } }),
    // Teams in the current Power rankings: each (ageGroup, gender, engine) partition's
    // latest snapshot, the same rows powerRankings.ts reads. Counted in SQL -- Prisma's
    // `distinct` dedupes in Node, which here meant pulling every rating row of the
    // season (one snapshot per nightly run) into the app on each dashboard load.
    activeSeasonId
      ? prisma.$queryRaw<{ gender: string; teams: bigint }[]>`
          SELECT h."gender"::text AS gender, COUNT(DISTINCT h."teamId") AS teams
          FROM "TeamRatingHistory" h
          JOIN (
            SELECT "ageGroup", "gender", "ratingEngine", MAX("weekEndingDate") AS latest
            FROM "TeamRatingHistory"
            WHERE "seasonId" = ${activeSeasonId}
            GROUP BY 1, 2, 3
          ) l ON l."ageGroup" = h."ageGroup" AND l."gender" = h."gender"
             AND l."ratingEngine" = h."ratingEngine" AND l.latest = h."weekEndingDate"
          WHERE h."seasonId" = ${activeSeasonId}
          GROUP BY 1`
      : [],
  ]);

  const fold = (groups: { gender: string; _count: { _all: number } }[]): GenderCounts => ({
    GIRLS: groups.filter((g) => g.gender !== "BOYS").reduce((sum, g) => sum + g._count._all, 0),
    BOYS: groups.find((g) => g.gender === "BOYS")?._count._all ?? 0,
  });

  return {
    teams: fold(teamGroups),
    divisions: fold(divisionGroups),
    boysMatches,
    powerRatedTeams: {
      GIRLS: ratedTeams.filter((t) => t.gender !== "BOYS").reduce((sum, t) => sum + Number(t.teams), 0),
      BOYS: ratedTeams.filter((t) => t.gender === "BOYS").reduce((sum, t) => sum + Number(t.teams), 0),
    } satisfies GenderCounts,
  };
}

/**
 * Everything that needs a person to do something, as counts -- the dashboard only
 * shows the ones above zero. Scoped to the active season where it's season-specific.
 */
export async function getAttentionItems(activeSeasonId: string | undefined): Promise<AttentionItem[]> {
  const now = Date.now();
  const nightlyStaleThreshold = new Date(now - NIGHTLY_STALE_HOURS * 60 * 60 * 1000);
  const staleRunningThreshold = new Date(now - STALE_RUNNING_MINUTES * 60 * 1000);
  const recentFailureThreshold = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [
    pendingImports,
    failedImports,
    unscoredDivisions,
    mislabeledDivisions,
    genderMismatchRows,
    unlinkedTeams,
    recentNightlyRuns,
    stuckRuns,
    recentFailedRuns,
  ] = await Promise.all([
    prisma.importBatch.count({ where: { status: { in: ["DRAFT", "RESOLVED"] } } }),
    prisma.importBatch.count({ where: { status: "FAILED" } }),
    activeSeasonId
      ? prisma.division.groupBy({
          by: ["gender"],
          where: { event: { seasonId: activeSeasonId }, scoringStatus: { not: "CONFIRMED" }, finishes: { some: {} } },
          _count: { _all: true },
        })
      : [],
    findMislabeledDivisions(activeSeasonId),
    // Same rule as teamGender.ts's genderFromTeamCode (leading "g"/"b"), counted in SQL
    // rather than pulling every TeamSeason row into the app.
    prisma.$queryRaw<{ teams: bigint }[]>`
      SELECT COUNT(DISTINCT ts."teamId") AS teams
      FROM "TeamSeason" ts
      JOIN "Team" t ON t."id" = ts."teamId"
      WHERE (lower(btrim(ts."externalTeamCode")) LIKE 'g%' AND t."gender" <> 'GIRLS')
         OR (lower(btrim(ts."externalTeamCode")) LIKE 'b%' AND t."gender" <> 'BOYS')`,
    prisma.team.count({ where: { clubId: null } }),
    prisma.jobRun.findMany({
      where: { kind: "NIGHTLY_RECOMPUTE", startedAt: { gte: nightlyStaleThreshold } },
      select: { status: true },
    }),
    prisma.jobRun.count({ where: { status: "RUNNING", startedAt: { lt: staleRunningThreshold } } }),
    prisma.jobRun.count({
      where: { status: "FAILED", kind: { not: "NIGHTLY_RECOMPUTE" }, startedAt: { gte: recentFailureThreshold } },
    }),
  ]);

  const genderMismatchTeams = Number(genderMismatchRows[0]?.teams ?? 0);

  const unscoredBoys = unscoredDivisions.find((g) => g.gender === "BOYS")?._count._all ?? 0;
  const unscoredGirls = unscoredDivisions
    .filter((g) => g.gender !== "BOYS")
    .reduce((sum, g) => sum + g._count._all, 0);

  const items: AttentionItem[] = [];

  if (recentNightlyRuns.length === 0) {
    items.push({
      label: `No nightly recompute in the last ${NIGHTLY_STALE_HOURS} hours`,
      count: 1,
      href: "/admin/job-runs",
      tone: "error",
    });
  } else {
    const failedNightly = recentNightlyRuns.filter((r) => r.status === "FAILED").length;
    if (failedNightly > 0) {
      items.push({ label: "Nightly recompute failed", count: failedNightly, href: "/admin/job-runs", tone: "error" });
    }
  }
  items.push(
    { label: "Recompute jobs stuck running", count: stuckRuns, href: "/admin/job-runs", tone: "error" },
    { label: "Recompute jobs failed in the last 7 days", count: recentFailedRuns, href: "/admin/job-runs", tone: "warning" },
    { label: "Failed imports", count: failedImports, href: "/admin/imports", tone: "error" },
    { label: "Imports waiting to be resolved or committed", count: pendingImports, href: "/admin/imports", tone: "warning" },
    {
      label: "Divisions labeled with the wrong gender",
      count: mislabeledDivisions.length,
      href: "/admin/division-genders",
      tone: "warning",
    },
    {
      label: "Teams whose gender disagrees with their team code",
      count: genderMismatchTeams,
      hint: "Fix with npm run db:audit-team-gender -- --apply, or each team's edit form.",
      tone: "warning",
    },
    { label: "Teams with no club", count: unlinkedTeams, href: "/admin/teams", tone: "info" },
    {
      label: "Boys divisions awaiting scoring",
      count: unscoredBoys,
      href: "/admin/analysis?gender=boys",
      tone: "info",
    },
    {
      label: "Girls divisions awaiting scoring",
      count: unscoredGirls,
      href: "/admin/analysis",
      tone: "info",
    },
  );

  return items.filter((item) => item.count > 0);
}

export type Freshness = {
  engines: { engine: RatingEngine; GIRLS: Date | null; BOYS: Date | null }[];
  nps: { GIRLS: Date | null; BOYS: Date | null };
  lastNightly: { status: JobRunStatus; startedAt: Date; finishedAt: Date | null } | null;
};

/** When each ranking was last computed for the active season, per girls/boys bucket. */
export async function getFreshness(activeSeasonId: string | undefined): Promise<Freshness> {
  const [ratingGroups, npsGroups, lastNightly] = await Promise.all([
    activeSeasonId
      ? prisma.teamRatingHistory.groupBy({
          by: ["ratingEngine", "gender"],
          where: { seasonId: activeSeasonId },
          _max: { createdAt: true },
        })
      : [],
    activeSeasonId
      ? prisma.rankingResult.groupBy({
          by: ["gender"],
          where: { seasonId: activeSeasonId },
          _max: { computedAt: true },
        })
      : [],
    prisma.jobRun.findFirst({
      where: { kind: "NIGHTLY_RECOMPUTE" },
      orderBy: { startedAt: "desc" },
      select: { status: true, startedAt: true, finishedAt: true },
    }),
  ]);

  const ratingAt = (engine: RatingEngine, gender: RankingGender) =>
    ratingGroups.find((g) => g.ratingEngine === engine && g.gender === gender)?._max.createdAt ?? null;
  const npsAt = (gender: RankingGender) => npsGroups.find((g) => g.gender === gender)?._max.computedAt ?? null;

  return {
    engines: (["COLLEY", "ELO", "MASSEY"] as const).map((engine) => ({
      engine,
      GIRLS: ratingAt(engine, "GIRLS"),
      BOYS: ratingAt(engine, "BOYS"),
    })),
    nps: { GIRLS: npsAt("GIRLS"), BOYS: npsAt("BOYS") },
    lastNightly,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_DAYS = 21;
const IMPORT_REMINDER_DAYS = 30;

/** Today's calendar date in Eastern time as a UTC-midnight Date -- Event start/end
 * dates are date-only values stored at UTC midnight, so this compares like with like. */
function todayEastern(): Date {
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return new Date(`${ymd}T00:00:00.000Z`);
}

export type DashboardEvent = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  location: string | null;
  scheduleCount: number;
};

/**
 * Events that haven't finished yet (next few weeks), plus finished events whose
 * results haven't been imported -- no COMMITTED team-finishes batch -- so staff get
 * reminded once the weekend is over. Events with a committed batch drop off the
 * reminder list on their own.
 */
export async function getEventSchedule() {
  const today = todayEastern();
  const select = {
    id: true,
    name: true,
    startDate: true,
    endDate: true,
    city: true,
    state: true,
    _count: { select: { schedules: true } },
  } as const;

  const [upcoming, needsImport] = await Promise.all([
    prisma.event.findMany({
      where: { endDate: { gte: today }, startDate: { lte: new Date(today.getTime() + UPCOMING_DAYS * DAY_MS) } },
      orderBy: { startDate: "asc" },
      select,
    }),
    prisma.event.findMany({
      where: {
        endDate: { lt: today, gte: new Date(today.getTime() - IMPORT_REMINDER_DAYS * DAY_MS) },
        importBatches: { none: { importType: "TEAM_FINISHES", status: "COMMITTED" } },
      },
      orderBy: { endDate: "desc" },
      select,
    }),
  ]);

  const shape = (e: (typeof upcoming)[number]): DashboardEvent => ({
    id: e.id,
    name: e.name,
    startDate: e.startDate,
    endDate: e.endDate,
    location: [e.city, e.state].filter(Boolean).join(", ") || null,
    scheduleCount: e._count.schedules,
  });
  return { upcoming: upcoming.map(shape), needsImport: needsImport.map(shape) };
}
