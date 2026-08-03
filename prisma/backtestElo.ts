import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getPartitionMatches, withDivisionWeights } from "../src/lib/rating/computeEloRatings";
import { buildEloMatches, computeEloHistory, DEFAULT_ELO_CONFIG, EloConfig, EloMatchWithId } from "../src/lib/rating/elo";
import { PredictionMetrics, scoreEloSteps } from "../src/lib/rating/predictionMetrics";

// Backtests Elo's predictive accuracy against every real completed Match, and
// grid-searches its tunable constants (see EloConfig) around today's defaults --
// docs/plan.md's Open Question 10, "Colley/Elo/Massey tuning constants ... are
// reasonable defaults from established practice, not calibrated to this dataset."
//
// Methodology note, worth keeping in mind reading the output below: divisionWeight
// (see divisionWeight.ts) is derived from *current* Colley TeamRatingHistory snapshots
// and *current* FSS percentiles among currently-known divisions, not a point-in-time
// historical snapshot as of each match's date. This backtest evaluates "how good are
// Elo's update-rule dynamics" using today's best-known division weights, not "how good
// would live predictions have been in real time as the season unfolded" -- the same
// lens production itself uses (it also always reads the latest snapshot, never a
// historical one). That's the right lens for tuning K/margin/provisional constants,
// which don't depend on divisionWeight at all; the divisionWeightEnabled toggle below
// is what isolates whether division weighting itself is pulling its weight.
//
// Run: npm run backtest:elo

type Partition = { seasonLabel: string; ageGroup: number; matches: EloMatchWithId[] };

async function gatherPartitions(prisma: PrismaClient): Promise<Partition[]> {
  const seasons = await prisma.season.findMany();
  const partitions: Partition[] = [];

  for (const season of seasons) {
    const teamSeasons = await prisma.teamSeason.findMany({
      where: { seasonId: season.id },
      select: { ageGroup: true },
      distinct: ["ageGroup"],
    });

    for (const { ageGroup } of teamSeasons) {
      const { matches } = await getPartitionMatches(season.id, ageGroup, new Date());
      if (matches.length === 0) continue;

      const enriched = await withDivisionWeights(matches);
      const eloMatches = buildEloMatches(enriched);
      if (eloMatches.length === 0) continue;

      console.log(
        `  ${season.label} / ${ageGroup}u: ${eloMatches.length.toLocaleString()} rated matches`,
      );
      partitions.push({ seasonLabel: season.label, ageGroup, matches: eloMatches });
    }
  }

  return partitions;
}

function runConfig(partitions: Partition[], config: EloConfig): PredictionMetrics {
  const allSteps = partitions.flatMap((p) => computeEloHistory(p.matches, config));
  return scoreEloSteps(allSteps);
}

function fmtMetrics(m: PredictionMetrics): string {
  if (m.n === 0) return "(no data)";
  return `accuracy ${m.accuracy.toFixed(4)}  logLoss ${m.logLoss.toFixed(4)}  brier ${m.brier.toFixed(4)}  n=${m.n.toLocaleString()}`;
}

type SweepPoint = { label: string; overrides: Partial<EloConfig>; isDefault: boolean };

function printSweep(
  title: string,
  partitions: Partition[],
  points: SweepPoint[],
): { bestOverrides: Partial<EloConfig>; bestLogLoss: number } {
  console.log(`\n${title}`);
  const rows = points.map((point) => ({
    point,
    metrics: runConfig(partitions, { ...DEFAULT_ELO_CONFIG, ...point.overrides }),
  }));
  rows.sort((a, b) => a.metrics.logLoss - b.metrics.logLoss);
  for (const { point, metrics } of rows) {
    console.log(`  ${point.label.padEnd(18)}${fmtMetrics(metrics)}${point.isDefault ? "  (default)" : ""}`);
  }
  return { bestOverrides: rows[0].point.overrides, bestLogLoss: rows[0].metrics.logLoss };
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const startedAt = Date.now();
  console.log("Gathering match partitions (season x ageGroup)...");
  const partitions = await gatherPartitions(prisma);
  const totalMatches = partitions.reduce((sum, p) => sum + p.matches.length, 0);
  console.log(
    `\nGathered ${partitions.length} partitions, ${totalMatches.toLocaleString()} total rated-match entries ` +
      `(a match played by a team playing up appears in both its own and its opponent's partition, so this can ` +
      `exceed the raw Match row count).`,
  );

  const baseline = runConfig(partitions, DEFAULT_ELO_CONFIG);
  console.log(`\nBaseline (today's defaults): ${fmtMetrics(baseline)}`);

  const results: { name: string; bestOverrides: Partial<EloConfig>; bestLogLoss: number }[] = [];

  results.push({
    name: "baseK",
    // Widened after two runs (dev 56k matches, prod 113k matches) both showed the
    // original [16,32] range still improving toward its upper edge -- see
    // docs/plan.md's Status entry for this backtest tool.
    ...printSweep(
      "baseK sweep",
      partitions,
      [16, 20, 24, 28, 32, 40, 48].map((v) => ({
        label: String(v),
        overrides: { baseK: v },
        isDefault: v === DEFAULT_ELO_CONFIG.baseK,
      })),
    ),
  });

  results.push({
    name: "provisionalK",
    // Widened -- both dev and prod runs kept improving monotonically all the way to
    // the old ceiling of 56.
    ...printSweep(
      "provisionalK sweep",
      partitions,
      [24, 32, 40, 48, 56, 64, 80, 100].map((v) => ({
        label: String(v),
        overrides: { provisionalK: v },
        isDefault: v === DEFAULT_ELO_CONFIG.provisionalK,
      })),
    ),
  });

  results.push({
    name: "provisionalMatchThreshold",
    // Widened -- both runs showed the *lower* values (5, 8) consistently worse than
    // the default, and monotonic improvement continuing past the old ceiling of 15, so
    // this drops the low end and extends the high end instead of spreading points
    // evenly across the old range.
    ...printSweep(
      "provisionalMatchThreshold sweep",
      partitions,
      [10, 15, 20, 25, 30, 40].map((v) => ({
        label: String(v),
        overrides: { provisionalMatchThreshold: v },
        isDefault: v === DEFAULT_ELO_CONFIG.provisionalMatchThreshold,
      })),
    ),
  });

  results.push({
    name: "marginStrength",
    // Widened -- both runs kept improving monotonically past the old ceiling of 2.
    ...printSweep(
      "marginStrength sweep (0 = no margin-of-victory adjustment, 1 = today's full effect)",
      partitions,
      [0, 0.5, 1, 1.5, 2, 2.5, 3, 4].map((v) => ({
        label: String(v),
        overrides: { marginStrength: v },
        isDefault: v === DEFAULT_ELO_CONFIG.marginStrength,
      })),
    ),
  });

  // Widened -- both runs kept improving monotonically past the old ceiling (2x
  // current). Generalized as a multiplier on how far win/loss are pushed from 1.0 (the
  // same direction OPEN_DIVISION_WIN_BONUS/LOSS_SOFTEN already push, just further),
  // rather than hardcoding more pairs by hand.
  const openBonusMultiples = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  const winOffset = DEFAULT_ELO_CONFIG.openDivisionWinBonus - 1; // +0.15
  const lossOffset = 1 - DEFAULT_ELO_CONFIG.openDivisionLossSoften; // +0.13 (applied as -offset)
  const openBonusPairs = openBonusMultiples.map((m) => ({
    label: m === 0 ? "off (1.0/1.0)" : m === 1 ? "current (1.15/0.87)" : `${m}x current`,
    win: 1 + winOffset * m,
    loss: 1 - lossOffset * m,
  }));
  results.push({
    name: "openDivisionBonus",
    ...printSweep(
      "Open-division win/loss bonus sweep",
      partitions,
      openBonusPairs.map((p) => ({
        label: p.label,
        overrides: { openDivisionWinBonus: p.win, openDivisionLossSoften: p.loss },
        isDefault: p.win === DEFAULT_ELO_CONFIG.openDivisionWinBonus,
      })),
    ),
  });

  results.push({
    name: "divisionWeightEnabled",
    ...printSweep(
      "divisionWeight on/off",
      partitions,
      [true, false].map((v) => ({
        label: String(v),
        overrides: { divisionWeightEnabled: v },
        isDefault: v === DEFAULT_ELO_CONFIG.divisionWeightEnabled,
      })),
    ),
  });

  const combinedOverrides = results.reduce((acc, r) => ({ ...acc, ...r.bestOverrides }), {} as Partial<EloConfig>);
  const combinedConfig = { ...DEFAULT_ELO_CONFIG, ...combinedOverrides };
  const combined = runConfig(partitions, combinedConfig);
  console.log(`\nCombined candidate (best value per dimension above): ${fmtMetrics(combined)}`);
  console.log(`  config: ${JSON.stringify(combinedConfig)}`);
  console.log(
    combined.logLoss < baseline.logLoss
      ? "  -> improves on baseline logLoss (per-dimension winners still help combined)."
      : "  -> does NOT improve on baseline logLoss (dimensions likely interact; not a real joint optimum).",
  );

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsedSec}s.`);
  console.log(
    "\nReminder: divisionWeight above reflects today's Colley snapshots, not point-in-time history -- see " +
      "the header comment in this file for what that does and doesn't validate.",
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
