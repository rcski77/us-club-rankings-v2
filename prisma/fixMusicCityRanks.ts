import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { fetchSportwrenchStandingsRows } from "../src/lib/import/sportwrenchStandings";
import { parseSportwrenchEventIdFromUrl } from "../src/lib/import/sportwrenchEventId";
import { resolvePoints } from "../src/lib/scoring/resolvePoints";
import { recomputeRankingsForDivision } from "../src/lib/ranking/computeRanking";

/**
 * One-off data fix: "26 NIKE Music City Championships" was imported via
 * fetchSportwrenchStandingsRows() before that function was corrected to read the
 * `rank` field instead of `seed_current` (see docs/plan.md's Sportwrench-import
 * section) -- a spot-check against live Sportwrench data found 520/810 committed
 * TeamFinish rows had a wrong rank. Re-fetches live standings and updates only
 * TeamFinish.rank (and, for already-CONFIRMED divisions, the points that rank
 * resolves to) in place -- does not touch Division/Club/Team/TeamSeason at all, per
 * explicit user request not to re-run the full import.
 */
async function main() {
  const event = await prisma.event.findFirst({ where: { name: { contains: "NIKE Music City" } } });
  if (!event) throw new Error("Event not found.");
  if (!event.scheduleUrl) throw new Error("Event has no scheduleUrl.");
  const sportwrenchEventId = parseSportwrenchEventIdFromUrl(event.scheduleUrl);
  if (!sportwrenchEventId) throw new Error(`Could not parse a Sportwrench event id from "${event.scheduleUrl}".`);

  console.log(`Fetching live standings for "${event.name}" (${sportwrenchEventId})...`);
  const live = await fetchSportwrenchStandingsRows(sportwrenchEventId);

  const liveRankByCode = new Map<string, number>();
  for (const row of live.rows) {
    const rank = Number(row.rank);
    if (Number.isFinite(rank) && rank > 0) liveRankByCode.set(row.teamCode.toLowerCase(), rank);
  }
  console.log(`Live teams with a valid rank: ${liveRankByCode.size}`);

  const finishes = await prisma.teamFinish.findMany({
    where: { division: { eventId: event.id } },
    include: {
      team: { include: { seasons: { where: { seasonId: event.seasonId } } } },
      division: { include: { pointBands: true } },
    },
  });
  console.log(`Committed finishes: ${finishes.length}`);

  let updated = 0;
  let pointsUpdated = 0;
  let noLiveMatch = 0;
  let unchanged = 0;
  const touchedConfirmedDivisionIds = new Set<string>();

  for (const f of finishes) {
    const code = f.team.seasons[0]?.externalTeamCode?.toLowerCase();
    const liveRank = code ? liveRankByCode.get(code) : undefined;
    if (liveRank == null) {
      noLiveMatch += 1;
      continue;
    }
    if (liveRank === f.rank) {
      unchanged += 1;
      continue;
    }

    const isConfirmed = f.division.scoringStatus === "CONFIRMED";
    const newPoints = isConfirmed ? resolvePoints(liveRank, f.division.pointBands) : f.points;

    await prisma.teamFinish.update({
      where: { id: f.id },
      data: { rank: liveRank, points: newPoints },
    });
    updated += 1;
    if (isConfirmed) {
      pointsUpdated += 1;
      touchedConfirmedDivisionIds.add(f.divisionId);
    }
  }

  console.log(
    `\nUpdated ${updated} rank(s) (${pointsUpdated} also had points recomputed), ${unchanged} already correct, ${noLiveMatch} had no live match.`,
  );

  for (const divisionId of touchedConfirmedDivisionIds) {
    await recomputeRankingsForDivision(divisionId);
  }
  console.log(`Recomputed rankings for ${touchedConfirmedDivisionIds.size} confirmed division(s).`);
}

main().finally(() => prisma.$disconnect());
