import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDivisionEloRatings, getEloPopulationRatings } from "../src/lib/rating/computeDivisionEloStrength";
import {
  computeEliteThreshold,
  computeIntrinsicElitePresence,
  ELITE_PERCENTILE,
  ELO_COVERAGE_THRESHOLD,
} from "../src/lib/rating/dci";

// Read-only report: does dci.ts's ELITE_PERCENTILE still produce a healthy split
// between genuinely elite and genuinely weaker divisions? Since the elite threshold
// is now derived from the *current* Elo population (computeEliteThreshold(), one
// percentile of one (season, ageGroup) partition's population at a time -- see
// computeDivisionScoringSuggestion.ts), it no longer drifts out of calibration the way
// the original fixed 1450 rating did when Elo's own tuning constants changed (see
// ELITE_PERCENTILE's comment in dci.ts for that whole history). This report exists to
// sanity-check the *percentile choice itself* (75 today), not to re-derive an absolute
// number to hardcode -- there's nothing to hardcode anymore. Doesn't recompute
// anything -- assumes Elo ratings are already fresh (i.e. "Recompute ratings" has been
// run recently on /admin/team-rankings, or the nightly job has run) -- this is a
// read-only diagnostic, not a rating recompute, so it's safe to run against prod
// anytime.
//
// Run: npm run analyze:elite-threshold
// Or against prod: ./run-prod-script.sh prisma/analyzeEliteThreshold.ts

function percentileValue(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const season = await prisma.season.findFirstOrThrow({ where: { isActive: true } });
  console.log(`Season: ${season.label} (${season.id})`);
  console.log(`Current ELITE_PERCENTILE: ${ELITE_PERCENTILE}\n`);

  const ageGroups = (
    await prisma.teamSeason.findMany({
      where: { seasonId: season.id },
      select: { ageGroup: true },
      distinct: ["ageGroup"],
    })
  )
    .map((r) => r.ageGroup)
    .sort((a, b) => a - b);

  console.log("--- Elo population + today's actual dynamic threshold, per age group ---");
  const populationByAgeGroup = new Map<number, number[]>();
  for (const ageGroup of ageGroups) {
    const ratings = await getEloPopulationRatings(season.id, ageGroup);
    if (ratings.length === 0) continue;
    populationByAgeGroup.set(ageGroup, ratings);
    const sorted = [...ratings].sort((a, b) => a - b);
    const threshold = computeEliteThreshold(ratings)!; // non-null: ratings.length > 0 here
    const eliteCount = ratings.filter((r) => r >= threshold).length;
    console.log(
      `${ageGroup}u: n=${ratings.length}  min=${sorted[0].toFixed(0)}  p25=${percentileValue(sorted, 25).toFixed(0)}  ` +
        `median=${percentileValue(sorted, 50).toFixed(0)}  p75=${percentileValue(sorted, 75).toFixed(0)}  ` +
        `max=${sorted[sorted.length - 1].toFixed(0)}  ` +
        `threshold@p${ELITE_PERCENTILE}=${threshold.toFixed(0)}  %>=threshold: ${((eliteCount / ratings.length) * 100).toFixed(1)}%`,
    );
  }

  // Gather every ELO-eligible division's rated-team list once, tagged with its own
  // ageGroup (the actual per-division scope computeDivisionScoringSuggestion.ts uses),
  // then re-derive Elite Presence per candidate percentile from that same cached list
  // -- no repeat DB work per candidate.
  console.log("\nGathering ELO-eligible divisions (>=50% Elo coverage)...");
  const divisions = await prisma.division.findMany({
    where: { event: { seasonId: season.id } },
    include: { event: true, finishes: true },
  });

  const divisionData: { label: string; teamCount: number; ratedCount: number; ageGroup: number; ratings: number[] }[] =
    [];
  for (const division of divisions) {
    const ratings = await getDivisionEloRatings(division.id);
    if (ratings.length === 0) continue;
    const coverage = ratings.length / division.finishes.length;
    if (coverage < ELO_COVERAGE_THRESHOLD) continue;
    divisionData.push({
      label: `${division.event.name} / ${division.name}`,
      teamCount: division.finishes.length,
      ratedCount: ratings.length,
      ageGroup: division.ageGroup,
      ratings: ratings.map((r) => r.rating),
    });
  }
  console.log(`${divisionData.length} divisions cleared the coverage gate.\n`);

  console.log("--- Candidate ELITE_PERCENTILE sweep (each division scored against its own age group's population) ---");
  const candidatePercentiles = Array.from(new Set([60, 65, 70, ELITE_PERCENTILE, 75, 80, 85, 90])).sort(
    (a, b) => a - b,
  );

  console.log(
    "percentile".padEnd(12) +
      "pinned@0%".padEnd(12) +
      "pinned@100%".padEnd(14) +
      "p25".padEnd(8) +
      "median".padEnd(8) +
      "p75".padEnd(8) +
      "(a healthy percentile keeps both pinned% low and spreads the middle)",
  );
  for (const p of candidatePercentiles) {
    const elitePresences = divisionData
      .map((d) => {
        const population = populationByAgeGroup.get(d.ageGroup) ?? [];
        const threshold = computeEliteThreshold(population, p);
        return threshold === null ? 0 : computeIntrinsicElitePresence(d.ratings, threshold);
      })
      .sort((a, b) => a - b);
    const pinnedZero = elitePresences.filter((e) => e === 0).length;
    const pinnedHundred = elitePresences.filter((e) => e === 100).length;
    const isCurrent = p === ELITE_PERCENTILE;
    console.log(
      `p${p}`.padEnd(12) +
        `${pinnedZero} (${((pinnedZero / elitePresences.length) * 100).toFixed(0)}%)`.padEnd(12) +
        `${pinnedHundred} (${((pinnedHundred / elitePresences.length) * 100).toFixed(0)}%)`.padEnd(14) +
        `${percentileValue(elitePresences, 25).toFixed(0)}%`.padEnd(8) +
        `${percentileValue(elitePresences, 50).toFixed(0)}%`.padEnd(8) +
        `${percentileValue(elitePresences, 75).toFixed(0)}%`.padEnd(8) +
        (isCurrent ? "  (current)" : ""),
    );
  }

  // Named-division sanity check, using each division's own age-group threshold at
  // ELITE_PERCENTILE -- i.e. exactly what production computes today. Change
  // CANDIDATE_PERCENTILE to try a different one before re-running.
  const CANDIDATE_PERCENTILE = ELITE_PERCENTILE;
  console.log(`\n--- Named divisions at p${CANDIDATE_PERCENTILE} (own age group's population) ---`);
  const named = divisionData
    .map((d) => {
      const population = populationByAgeGroup.get(d.ageGroup) ?? [];
      const threshold = computeEliteThreshold(population, CANDIDATE_PERCENTILE);
      const elite = threshold === null ? 0 : computeIntrinsicElitePresence(d.ratings, threshold);
      return { ...d, threshold, elite };
    })
    .sort((a, b) => b.elite - a.elite);

  console.log("elite%".padEnd(10) + "threshold".padEnd(12) + "teams".padEnd(8) + "division");
  console.log("Top 20 by Elite Presence (expect known big/championship-tier events near the top):");
  for (const d of named.slice(0, 20)) {
    console.log(
      `${d.elite.toFixed(0)}%`.padEnd(10) +
        `${d.threshold?.toFixed(0) ?? "-"}`.padEnd(12) +
        `${d.ratedCount}/${d.teamCount}`.padEnd(8) +
        d.label,
    );
  }
  console.log("\nBottom 10 by Elite Presence (expect genuinely smaller/weaker regional fields):");
  for (const d of named.slice(-10)) {
    console.log(
      `${d.elite.toFixed(0)}%`.padEnd(10) +
        `${d.threshold?.toFixed(0) ?? "-"}`.padEnd(12) +
        `${d.ratedCount}/${d.teamCount}`.padEnd(8) +
        d.label,
    );
  }

  console.log(
    "\nReminder: this is descriptive, not a predictive-accuracy backtest like Elo's constants got -- " +
      "there's no scoreable ground truth for 'was this division correctly called elite,' so picking a new " +
      "ELITE_PERCENTILE from this table (or the named-division sanity check above) is a judgment call, not an " +
      "optimization result.",
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
