// DB-free helpers for the seeding report (kept apart from the Prisma-importing modules so
// vitest can load them without the "@/" alias).

/** Fewer matches than this before the event = "thin data". */
export const THIN_MATCH_THRESHOLD = 5;

/**
 * Among the TeamSeason rows that share one code: prefer the report season, otherwise the
 * most recent season.
 */
export function pickBestSeasonRow<T extends { seasonId: string; seasonStart: Date }>(
  rows: T[],
  seasonId: string,
): T | undefined {
  const current = rows.find((r) => r.seasonId === seasonId);
  if (current) return current;
  return [...rows].sort((a, b) => b.seasonStart.getTime() - a.seasonStart.getTime())[0];
}

/** Leading age number of a division name ("18 Open" -> 18), or null. */
export function divisionAgeFromName(name: string): number | null {
  const m = /^\s*(\d{1,2})/.exec(name);
  return m ? Number(m[1]) : null;
}

/** Average of the ranks that exist, or null. */
export function averageRank(ranks: (number | null)[]): number | null {
  const present = ranks.filter((r): r is number => r !== null);
  if (present.length === 0) return null;
  return present.reduce((s, r) => s + r, 0) / present.length;
}

/**
 * Do the engines disagree enough to warrant a flag? Spread between best and worst engine
 * rank beyond max(10, 25% of the larger rank) -- ranks are partition-wide (thousands of
 * teams), so a fixed spread would be noise at the bottom of the field.
 */
export function enginesDisagree(ranks: (number | null)[]): boolean {
  const present = ranks.filter((r): r is number => r !== null);
  if (present.length < 2) return false;
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  return hi - lo > Math.max(10, hi * 0.25);
}
