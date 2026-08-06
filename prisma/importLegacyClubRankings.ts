import "dotenv/config";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { uniqueSlug } from "../src/lib/slug";

// Imports the legacy v1 5-year club ranking workbook's already-computed output
// (2021-2025 per-club-per-year totals, plus the 2025 per-age-group breakdown) as
// historical seed data -- see docs/plan.md's legacy 5-year import note and
// prisma/legacy-club-rankings/*.csv (extracted from the source workbook once, via the
// xlsx skill; see those files' own header row for the expected shape). Idempotent:
// upserts on (clubId, year) / (clubId, year, ageGroup), safe to re-run. Takes CSV
// paths as args so a future year's export can be re-imported without a code change:
//
//   tsx prisma/importLegacyClubRankings.ts [annual-scores.csv] [annual-age-group-scores.csv]

type AnnualScoreRow = {
  year: string;
  clubCode: string;
  clubName: string;
  state: string;
  totalPoints: string;
  legacyRank: string;
};

type AgeGroupScoreRow = {
  year: string;
  ageGroup: string;
  clubCode: string;
  teamName: string;
  teamCode: string;
  rank: string;
  npsPoints: string;
  clubPoints: string;
};

function decodeClubCode(code: string): { externalCode: string; regionCode: string } | null {
  const trimmed = code.trim();
  if (trimmed.length !== 7) return null;
  return {
    externalCode: trimmed.slice(0, 5).toLowerCase(),
    regionCode: trimmed.slice(5, 7).toUpperCase(),
  };
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const annualScoresPath =
    process.argv[2] ?? `${__dirname}/legacy-club-rankings/annual-scores.csv`;
  const ageGroupScoresPath =
    process.argv[3] ?? `${__dirname}/legacy-club-rankings/annual-age-group-scores.csv`;

  const annualRows: AnnualScoreRow[] = parse(readFileSync(annualScoresPath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
  });
  const ageGroupRows: AgeGroupScoreRow[] = parse(readFileSync(ageGroupScoresPath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
  });

  const regions = await prisma.region.findMany();
  const regionByCode = new Map(regions.map((r) => [r.code, r]));

  // clubCode (7-char) -> resolved Club.id, built up as rows are processed so repeat
  // codes within/across both CSVs only hit the DB once each.
  const clubIdByCode = new Map<string, string>();
  let clubsMatched = 0;
  let clubsCreated = 0;
  const unresolvedRegionCodes = new Set<string>();
  const skippedRows: string[] = [];

  async function resolveClub(
    clubCode: string,
    nameHint: string | undefined,
    stateHint: string | undefined,
  ): Promise<string | null> {
    const cached = clubIdByCode.get(clubCode);
    if (cached) return cached;

    const decoded = decodeClubCode(clubCode);
    if (!decoded) {
      skippedRows.push(`Malformed club code "${clubCode}" (expected 7 chars)`);
      return null;
    }

    const region = regionByCode.get(decoded.regionCode);
    if (!region) {
      unresolvedRegionCodes.add(decoded.regionCode);
      skippedRows.push(`Unresolved region code "${decoded.regionCode}" for club code "${clubCode}"`);
      return null;
    }

    const existing = await prisma.club.findUnique({
      where: { externalCode_regionId: { externalCode: decoded.externalCode, regionId: region.id } },
    });
    if (existing) {
      clubIdByCode.set(clubCode, existing.id);
      clubsMatched += 1;
      return existing.id;
    }

    const name = nameHint?.trim() || clubCode;
    const slug = await uniqueSlug(name, async (candidate) => {
      const found = await prisma.club.findUnique({ where: { slug: candidate } });
      return found !== null;
    });
    const created = await prisma.club.create({
      data: {
        name,
        slug,
        externalCode: decoded.externalCode,
        regionId: region.id,
        state: stateHint?.trim() || null,
      },
    });
    clubIdByCode.set(clubCode, created.id);
    clubsCreated += 1;
    return created.id;
  }

  let annualScoresWritten = 0;
  for (const row of annualRows) {
    const clubId = await resolveClub(row.clubCode, row.clubName, row.state);
    if (!clubId) continue;

    await prisma.clubAnnualScore.upsert({
      where: { clubId_year: { clubId, year: Number(row.year) } },
      update: {
        totalPoints: Number(row.totalPoints),
        legacyRank: row.legacyRank ? Number(row.legacyRank) : null,
      },
      create: {
        clubId,
        year: Number(row.year),
        totalPoints: Number(row.totalPoints),
        legacyRank: row.legacyRank ? Number(row.legacyRank) : null,
        source: "LEGACY_IMPORT",
      },
    });
    annualScoresWritten += 1;
  }

  // A club can have more than one team in the same (year, ageGroup) -- e.g. a "16-1"
  // and "16-2" squad -- but the unique key here is (clubId, year, ageGroup), same
  // "club's single best-ranked team per age group" convention clubRanking.ts already
  // applies (see computeClubRankingForSeason's bestByClub reduction). Keep only the
  // lowest (best) rank per club/year/ageGroup rather than letting upsert order decide.
  const bestAgeGroupRow = new Map<string, AgeGroupScoreRow>();
  for (const row of ageGroupRows) {
    const key = `${row.clubCode}|${row.year}|${row.ageGroup}`;
    const existing = bestAgeGroupRow.get(key);
    const rank = row.rank ? Number(row.rank) : Number.POSITIVE_INFINITY;
    const existingRank = existing?.rank ? Number(existing.rank) : Number.POSITIVE_INFINITY;
    if (!existing || rank < existingRank) {
      bestAgeGroupRow.set(key, row);
    }
  }

  let ageGroupScoresWritten = 0;
  for (const row of bestAgeGroupRow.values()) {
    const clubId = await resolveClub(row.clubCode, undefined, undefined);
    if (!clubId) continue;

    await prisma.clubAnnualAgeGroupScore.upsert({
      where: {
        clubId_year_ageGroup: { clubId, year: Number(row.year), ageGroup: Number(row.ageGroup) },
      },
      update: {
        teamName: row.teamName || null,
        teamCode: row.teamCode || null,
        rank: row.rank ? Number(row.rank) : null,
        npsPoints: row.npsPoints ? Number(row.npsPoints) : null,
        clubPoints: row.clubPoints ? Number(row.clubPoints) : null,
      },
      create: {
        clubId,
        year: Number(row.year),
        ageGroup: Number(row.ageGroup),
        teamName: row.teamName || null,
        teamCode: row.teamCode || null,
        rank: row.rank ? Number(row.rank) : null,
        npsPoints: row.npsPoints ? Number(row.npsPoints) : null,
        clubPoints: row.clubPoints ? Number(row.clubPoints) : null,
      },
    });
    ageGroupScoresWritten += 1;
  }

  console.log(`\nAnnual scores: ${annualScoresWritten}/${annualRows.length} rows written`);
  console.log(`Age-group scores: ${ageGroupScoresWritten}/${ageGroupRows.length} rows written`);
  console.log(`Clubs matched to existing rows: ${clubsMatched}`);
  console.log(`Clubs newly created: ${clubsCreated}`);
  if (unresolvedRegionCodes.size > 0) {
    console.log(`Unresolved region codes: ${[...unresolvedRegionCodes].join(", ")}`);
  }
  if (skippedRows.length > 0) {
    console.log(`\n${skippedRows.length} rows skipped, e.g.:`);
    for (const msg of skippedRows.slice(0, 20)) console.log(`  - ${msg}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
