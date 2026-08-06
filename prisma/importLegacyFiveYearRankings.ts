import "dotenv/config";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createLegacyClubResolver } from "./legacyClubResolver";
import { LEGACY_IMPORT_ALGORITHM_VERSION } from "../src/lib/ranking/computeFiveYearClubRanking";

// Imports the legacy workbook's already-final 5-year-aggregate results for
// 2021-2024 (the "5 Year to Publish" sheet's per-year Ranking/Points columns --
// confirmed each year's column is that year's own rolling 5-year-window rank/total,
// not a single-year rank, by matching its "2025 Points" column against this app's own
// endYear=2025 computation exactly). 2025 itself is deliberately NOT imported here --
// this app already computes that window correctly from ClubAnnualScore (matches the
// legacy sheet exactly) and that computed row carries real per-year contributions
// this sheet doesn't have; importing it here would only ever be redundant, and would
// overwrite those contributions with nothing.
//
// These rows have no underlying 2017-2020 data in this app to recompute from (only
// 2021-2025 was imported, see importLegacyClubRankings.ts), so they're written
// directly as the final result -- algorithmVersion: "legacy-import" marks that
// provenance, same as ClubAnnualScore's source field, so the admin UI can tell a
// frozen legacy window apart from one this app's own pipeline computed and warn
// against recomputing over it (see src/app/admin/club-rankings/five-year/page.tsx).
//
// Idempotent: upserts on (endYear, clubId), safe to re-run.
//
//   tsx prisma/importLegacyFiveYearRankings.ts [five-year-published.csv]

type PublishedRow = {
  endYear: string;
  clubCode: string;
  clubName: string;
  rank: string;
  totalPoints: string;
};

const ALGORITHM_VERSION = LEGACY_IMPORT_ALGORITHM_VERSION;

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const csvPath = process.argv[2] ?? `${__dirname}/legacy-club-rankings/five-year-published.csv`;
  const rows: PublishedRow[] = parse(readFileSync(csvPath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
  });

  const resolver = createLegacyClubResolver(prisma);

  let written = 0;
  let skippedExistingComputed = 0;
  for (const row of rows) {
    const endYear = Number(row.endYear);
    const clubId = await resolver.resolveClub(row.clubCode, row.clubName, undefined);
    if (!clubId) continue;

    // Never overwrite a row this app's own pipeline computed (e.g. if a future year's
    // real ClubAnnualScore data ever makes endYear < 2025 independently computable) --
    // only ever fill in where nothing real exists yet.
    const existing = await prisma.clubFiveYearRankingResult.findUnique({
      where: { endYear_clubId: { endYear, clubId } },
    });
    if (existing && existing.algorithmVersion !== ALGORITHM_VERSION) {
      skippedExistingComputed += 1;
      continue;
    }

    await prisma.clubFiveYearRankingResult.upsert({
      where: { endYear_clubId: { endYear, clubId } },
      update: {
        totalPoints: Number(row.totalPoints),
        rank: Number(row.rank),
        algorithmVersion: ALGORITHM_VERSION,
      },
      create: {
        id: randomUUID(),
        endYear,
        clubId,
        totalPoints: Number(row.totalPoints),
        rank: Number(row.rank),
        algorithmVersion: ALGORITHM_VERSION,
      },
    });
    written += 1;
  }

  console.log(`\nFive-year published rows: ${written}/${rows.length} written`);
  if (skippedExistingComputed > 0) {
    console.log(`Skipped ${skippedExistingComputed} rows that already had a computed (non-legacy) result`);
  }
  console.log(`Clubs matched to existing rows: ${resolver.clubsMatched}`);
  console.log(`Clubs newly created: ${resolver.clubsCreated}`);
  if (resolver.unresolvedRegionCodes.size > 0) {
    console.log(`Unresolved region codes: ${[...resolver.unresolvedRegionCodes].join(", ")}`);
  }
  if (resolver.skippedRows.length > 0) {
    console.log(`\n${resolver.skippedRows.length} rows skipped, e.g.:`);
    for (const msg of resolver.skippedRows.slice(0, 20)) console.log(`  - ${msg}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
