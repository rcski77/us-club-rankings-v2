/**
 * Normalizes a Date to UTC midnight of its calendar day. Every engine's
 * delete-and-replace snapshot pattern (computeColleyRatings.ts, computeEloRatings.ts,
 * computeMasseyRatings.ts) matches on exact `weekEndingDate` equality before
 * inserting a fresh set of rows -- but the `*ForSeason` entry points default
 * `weekEndingDate` to `new Date()`, which is precise to the millisecond. Two recompute
 * runs on the same day therefore never produce an equal timestamp, so the "replace"
 * half of delete-and-replace silently never matches anything: every run just adds a
 * new, never-cleaned-up snapshot on top of every prior one from that same day. Reads
 * are unaffected (every query takes the latest `weekEndingDate`), but the table grows
 * unbounded. Truncating to the day here, at the point every engine actually persists a
 * snapshot, makes same-day recomputes collapse onto one comparable timestamp so
 * delete-and-replace behaves the way its own doc comments already describe.
 */
export function normalizeWeekEndingDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
