import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeRanking } from "../src/lib/ranking/computeRanking";

// Rebuilds the sample walkthrough data used while testing Phase 1: one club, four
// teams (one deliberately playing up an age group), one anchor event with a division
// scored against the legacy 245/230/220/180 curve, and the resulting rankings.
// Queries are sequential throughout -- the local `prisma dev` Postgres doesn't
// reliably handle concurrent queries from the same pool (see computeRanking.ts).
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const region = await prisma.region.findUnique({ where: { code: "NT" } });
  if (!region) throw new Error("Run `npm run db:seed-regions` first.");

  let season = await prisma.season.findUnique({ where: { label: "2025-2026" } });
  if (!season) {
    season = await prisma.season.create({
      data: {
        label: "2025-2026",
        startDate: new Date("2025-09-01"),
        endDate: new Date("2026-08-31"),
      },
    });
  }
  const seasonId = season.id;
  // Only one season should ever be active -- mirror what the Seasons page's
  // "Set active" action does rather than blindly setting isActive on create.
  await prisma.season.updateMany({ data: { isActive: false } });
  await prisma.season.update({ where: { id: seasonId }, data: { isActive: true } });

  const club = await prisma.club.upsert({
    where: { slug: "madfrog-volleyball" },
    update: {},
    create: {
      name: "MadFrog Volleyball",
      slug: "madfrog-volleyball",
      externalCode: "frogs",
      regionId: region.id,
    },
  });

  async function upsertTeam(name: string, clubId: string | null, ageGroup: number, externalTeamCode?: string) {
    let team = await prisma.team.findFirst({ where: { name } });
    if (!team) {
      team = await prisma.team.create({ data: { name, clubId } });
    }
    const existingSeason = await prisma.teamSeason.findUnique({
      where: { teamId_seasonId: { teamId: team.id, seasonId } },
    });
    if (!existingSeason) {
      await prisma.teamSeason.create({
        data: { teamId: team.id, seasonId, ageGroup, teamNumber: 1, externalTeamCode },
      });
    }
    return team;
  }

  const madfrog = await upsertTeam("MADFROG 14'S N GREEN", club.id, 14, "g14frogs1nt");
  const tav = await upsertTeam("TAV 14 Black", null, 14, "g14txadv1nt");
  const legacy = await upsertTeam("Legacy 14-1 ADIDAS", null, 14);
  const dynasty = await upsertTeam("Dynasty 13 Black (playing up)", null, 13);

  const event = await prisma.event.upsert({
    where: { slug: "2026-triple-crown-nit" },
    update: {},
    create: {
      seasonId,
      name: "2026 Triple Crown NIT",
      slug: "2026-triple-crown-nit",
      startDate: new Date("2026-02-14"),
      endDate: new Date("2026-02-16"),
      isAnchor: true,
    },
  });

  let division = await prisma.division.findFirst({
    where: { eventId: event.id, slug: "14-open" },
  });
  if (!division) {
    division = await prisma.division.create({
      data: {
        eventId: event.id,
        name: "14 Open",
        slug: "14-open",
        ageGroup: 14,
        tierLabel: "OPEN",
      },
    });
  }

  const template = await prisma.pointTemplate.upsert({
    where: { name: "245 max (USAV Nationals tier)" },
    update: {},
    create: { name: "245 max (USAV Nationals tier)", isAnchorTemplate: true, maxPoints: 245 },
  });
  const existingBands = await prisma.pointTemplateBand.findMany({
    where: { pointTemplateId: template.id },
  });
  if (existingBands.length === 0) {
    await prisma.pointTemplateBand.createMany({
      data: [
        { pointTemplateId: template.id, fromRank: 1, toRank: 1, points: 245 },
        { pointTemplateId: template.id, fromRank: 2, toRank: 2, points: 230 },
        { pointTemplateId: template.id, fromRank: 3, toRank: 4, points: 220 },
        { pointTemplateId: template.id, fromRank: 26, toRank: 0, points: 180 },
      ],
    });
  }

  const divisionId = division.id;

  const existingDivisionBands = await prisma.divisionPointBand.findMany({
    where: { divisionId },
  });
  if (existingDivisionBands.length === 0) {
    const bands = await prisma.pointTemplateBand.findMany({ where: { pointTemplateId: template.id } });
    await prisma.divisionPointBand.createMany({
      data: bands.map((b) => ({ divisionId, fromRank: b.fromRank, toRank: b.toRank, points: b.points })),
    });
  }

  async function upsertFinish(teamId: string, rank: number, ignoreAge = false) {
    const existing = await prisma.teamFinish.findUnique({
      where: { divisionId_teamId: { divisionId, teamId } },
    });
    if (!existing) {
      await prisma.teamFinish.create({ data: { divisionId, teamId, rank, ignoreAge } });
    }
  }

  await upsertFinish(madfrog.id, 1);
  await upsertFinish(tav.id, 2);
  await upsertFinish(legacy.id, 3);
  await upsertFinish(dynasty.id, 4, true);

  const finalDivision = await prisma.division.findUniqueOrThrow({
    where: { id: divisionId },
    include: { pointBands: true, finishes: true },
  });

  function resolvePoints(rank: number, bands: { fromRank: number; toRank: number; points: number }[]) {
    const band = bands.find((b) => rank >= b.fromRank && (b.toRank === 0 || rank <= b.toRank));
    return band?.points ?? 0;
  }

  for (const f of finalDivision.finishes) {
    await prisma.teamFinish.update({
      where: { id: f.id },
      data: { points: resolvePoints(f.rank, finalDivision.pointBands) },
    });
  }
  await prisma.division.update({ where: { id: divisionId }, data: { scoringStatus: "CONFIRMED" } });

  await computeRanking(seasonId, 14);
  await computeRanking(seasonId, 13);

  console.log("Seeded demo data:");
  console.log(`  Season: ${season.label}`);
  console.log(`  Club: ${club.name}`);
  console.log(`  Event: ${event.name} -> Division: ${finalDivision.name}`);
  console.log(`  Teams: ${madfrog.name}, ${tav.name}, ${legacy.name}, ${dynasty.name}`);
  console.log("  Confirmed scoring and computed 14u + 13u rankings.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
