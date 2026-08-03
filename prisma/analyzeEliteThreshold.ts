import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDivisionEloRatings, getEloPopulationRatings } from "../src/lib/rating/computeDivisionEloStrength";
import { computeIntrinsicElitePresence, ELO_COVERAGE_THRESHOLD, ELO_ELITE_THRESHOLD } from "../src/lib/rating/dci";

// Read-only report: does dci.ts's ELO_ELITE_THRESHOLD (currently hardcoded, an
// absolute Elo cutoff for "elite") still land where it should, now that Elo's own
// tuning constants were recalibrated (see docs/plan.md's Status entry, 2026-08-03)?
// That recalibration widened Elo's spread from the 1500 default, which can silently
// move the whole population relative to any *absolute* threshold like this one --
// unlike divisionWeight.ts's WEIGHT_MIN/MAX, which are population-relative by
// construction and don't have this failure mode. Doesn't recompute anything --
// assumes Elo ratings are already fresh (i.e. "Recompute ratings" has been run
// recently on /admin/team-rankings, or the nightly job has run) -- this is a read-only
// diagnostic, not a rating recompute, so it's safe to run against prod anytime.
//
// Run: npm run analyze:elite-threshold
// Or against prod: ./run-prod-script.sh prisma/analyzeEliteThreshold.ts

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const season = await prisma.season.findFirstOrThrow({ where: { isActive: true } });
  console.log(`Season: ${season.label} (${season.id})`);
  console.log(`Current ELO_ELITE_THRESHOLD: ${ELO_ELITE_THRESHOLD}\n`);

  const ageGroups = (
    await prisma.teamSeason.findMany({
      where: { seasonId: season.id },
      select: { ageGroup: true },
      distinct: ["ageGroup"],
    })
  )
    .map((r) => r.ageGroup)
    .sort((a, b) => a - b);

  console.log("--- Elo population distribution per age group ---");
  let allRatings: number[] = [];
  for (const ageGroup of ageGroups) {
    const ratings = await getEloPopulationRatings(season.id, ageGroup);
    if (ratings.length === 0) continue;
    allRatings = allRatings.concat(ratings);
    const sorted = [...ratings].sort((a, b) => a - b);
    const mean = ratings.reduce((s, r) => s + r, 0) / ratings.length;
    const eliteCount = ratings.filter((r) => r >= ELO_ELITE_THRESHOLD).length;
    console.log(
      `${ageGroup}u: n=${ratings.length}  min=${sorted[0].toFixed(0)}  p25=${percentile(sorted, 25).toFixed(0)}  ` +
        `median=${percentile(sorted, 50).toFixed(0)}  mean=${mean.toFixed(0)}  p75=${percentile(sorted, 75).toFixed(0)}  ` +
        `p90=${percentile(sorted, 90).toFixed(0)}  max=${sorted[sorted.length - 1].toFixed(0)}  ` +
        `%>=${ELO_ELITE_THRESHOLD}: ${((eliteCount / ratings.length) * 100).toFixed(1)}%`,
    );
  }

  const sortedAll = [...allRatings].sort((a, b) => a - b);
  console.log(
    `\nAll age groups combined: n=${allRatings.length}  p25=${percentile(sortedAll, 25).toFixed(0)}  ` +
      `median=${percentile(sortedAll, 50).toFixed(0)}  p50=${percentile(sortedAll, 50).toFixed(0)}  ` +
      `p60=${percentile(sortedAll, 60).toFixed(0)}  p65=${percentile(sortedAll, 65).toFixed(0)}  ` +
      `p70=${percentile(sortedAll, 70).toFixed(0)}  p75=${percentile(sortedAll, 75).toFixed(0)}  ` +
      `p80=${percentile(sortedAll, 80).toFixed(0)}  p85=${percentile(sortedAll, 85).toFixed(0)}  ` +
      `p90=${percentile(sortedAll, 90).toFixed(0)}`,
  );

  // Gather every ELO-eligible division's rated-team list once (same 50%-coverage gate
  // computeDivisionScoringSuggestion.ts uses to trust the DCI/Elo path), then re-derive
  // Elite Presence per candidate threshold from that same cached list -- no repeat DB
  // work per candidate.
  console.log("\nGathering ELO-eligible divisions (>=50% Elo coverage)...");
  const divisions = await prisma.division.findMany({
    where: { event: { seasonId: season.id } },
    include: { event: true, finishes: true },
  });

  const divisionRatings: { label: string; teamCount: number; ratedCount: number; ratings: number[] }[] = [];
  for (const division of divisions) {
    const ratings = await getDivisionEloRatings(division.id);
    if (ratings.length === 0) continue;
    const coverage = ratings.length / division.finishes.length;
    if (coverage < ELO_COVERAGE_THRESHOLD) continue;
    divisionRatings.push({
      label: `${division.event.name} / ${division.name}`,
      teamCount: division.finishes.length,
      ratedCount: ratings.length,
      ratings: ratings.map((r) => r.rating),
    });
  }
  console.log(`${divisionRatings.length} divisions cleared the coverage gate.\n`);

  console.log("--- Candidate threshold sweep (division-level Elite Presence clustering) ---");
  const candidates = [
    ELO_ELITE_THRESHOLD,
    percentile(sortedAll, 60),
    percentile(sortedAll, 65),
    percentile(sortedAll, 70),
    percentile(sortedAll, 75),
    percentile(sortedAll, 80),
    percentile(sortedAll, 85),
    percentile(sortedAll, 90),
    1500,
    1550,
    1600,
    1650,
    1700,
    1750,
  ];
  const uniqueCandidates = Array.from(new Set(candidates.map((c) => Math.round(c)))).sort((a, b) => a - b);

  console.log(
    "threshold".padEnd(12) +
      "pinned@0%".padEnd(12) +
      "pinned@100%".padEnd(14) +
      "p25".padEnd(8) +
      "median".padEnd(8) +
      "p75".padEnd(8) +
      "(a healthy threshold keeps both pinned% low and spreads the middle)",
  );
  for (const threshold of uniqueCandidates) {
    const elitePresences = divisionRatings
      .map((d) => computeIntrinsicElitePresence(d.ratings, threshold))
      .sort((a, b) => a - b);
    const pinnedZero = elitePresences.filter((e) => e === 0).length;
    const pinnedHundred = elitePresences.filter((e) => e === 100).length;
    const isCurrent = threshold === Math.round(ELO_ELITE_THRESHOLD);
    console.log(
      `${threshold}`.padEnd(12) +
        `${pinnedZero} (${((pinnedZero / elitePresences.length) * 100).toFixed(0)}%)`.padEnd(12) +
        `${pinnedHundred} (${((pinnedHundred / elitePresences.length) * 100).toFixed(0)}%)`.padEnd(14) +
        `${percentile(elitePresences, 25).toFixed(0)}%`.padEnd(8) +
        `${percentile(elitePresences, 50).toFixed(0)}%`.padEnd(8) +
        `${percentile(elitePresences, 75).toFixed(0)}%`.padEnd(8) +
        (isCurrent ? "  (current)" : ""),
    );
  }

  console.log(
    "\nReminder: this is descriptive, not a predictive-accuracy backtest like Elo's constants got -- " +
      "there's no scoreable ground truth for 'was this division correctly called elite,' so picking a new " +
      "threshold from this table is a judgment call (same as how the original 1450 was picked), not an " +
      "optimization result.",
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
