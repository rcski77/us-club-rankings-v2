import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Seeds the non-anchor PointTemplate library from real curves used last season (see
// docs/plan.md Status: "current dev seed data has no non-anchor PointTemplate, so the
// suggestion pipeline has nothing real to suggest against"). Upserts by name so it's
// safe to re-run; bands are replaced wholesale on each run (delete + recreate) rather
// than diffed, since these are reference-data snapshots, not user-edited templates
// with confirmed divisions pointing at them via DivisionPointBand (frozen-copy
// elsewhere protects confirmed scoring regardless).
//
// Add more templates to this list as more screenshots come in.
type TemplateSeed = {
  name: string;
  description: string;
  bands: { fromRank: number; toRank: number; points: number }[];
};

const TEMPLATES: TemplateSeed[] = [
  {
    name: "230 max",
    description: "Top qualifier tier, max 230.",
    bands: [
      { fromRank: 1, toRank: 1, points: 230 },
      { fromRank: 2, toRank: 2, points: 220 },
      { fromRank: 3, toRank: 4, points: 210 },
      { fromRank: 5, toRank: 8, points: 200 },
      { fromRank: 9, toRank: 12, points: 190 },
      { fromRank: 13, toRank: 17, points: 180 },
      { fromRank: 18, toRank: 25, points: 170 },
      { fromRank: 26, toRank: 0, points: 160 },
    ],
  },
  {
    name: "215 max",
    description: "Top qualifier tier, max 215.",
    bands: [
      { fromRank: 1, toRank: 1, points: 215 },
      { fromRank: 2, toRank: 2, points: 210 },
      { fromRank: 3, toRank: 4, points: 200 },
      { fromRank: 5, toRank: 8, points: 190 },
      { fromRank: 9, toRank: 16, points: 170 },
      { fromRank: 17, toRank: 24, points: 150 },
      { fromRank: 25, toRank: 0, points: 130 },
    ],
  },
  {
    name: "235 max",
    description: "Top qualifier tier, max 235.",
    bands: [
      { fromRank: 1, toRank: 1, points: 235 },
      { fromRank: 2, toRank: 2, points: 225 },
      { fromRank: 3, toRank: 4, points: 215 },
      { fromRank: 5, toRank: 8, points: 205 },
      { fromRank: 9, toRank: 12, points: 195 },
      { fromRank: 13, toRank: 17, points: 190 },
      { fromRank: 18, toRank: 25, points: 185 },
      { fromRank: 26, toRank: 33, points: 182 },
      { fromRank: 34, toRank: 40, points: 175 },
      { fromRank: 41, toRank: 65, points: 170 },
      { fromRank: 66, toRank: 83, points: 165 },
      { fromRank: 84, toRank: 0, points: 160 },
    ],
  },
  {
    name: "190 max (USAV Qualifier Open)",
    description: "Used for most USAV qualifier Open divisions last season.",
    bands: [
      { fromRank: 1, toRank: 1, points: 190 },
      { fromRank: 2, toRank: 2, points: 185 },
      { fromRank: 3, toRank: 4, points: 180 },
      { fromRank: 5, toRank: 8, points: 170 },
      { fromRank: 9, toRank: 16, points: 160 },
      { fromRank: 17, toRank: 24, points: 140 },
      { fromRank: 25, toRank: 32, points: 120 },
      { fromRank: 33, toRank: 0, points: 100 },
    ],
  },
  {
    name: "185 max",
    description: "Qualifier tier, max 185.",
    bands: [
      { fromRank: 1, toRank: 1, points: 185 },
      { fromRank: 2, toRank: 2, points: 180 },
      { fromRank: 3, toRank: 4, points: 175 },
      { fromRank: 5, toRank: 8, points: 165 },
      { fromRank: 9, toRank: 16, points: 155 },
      { fromRank: 17, toRank: 24, points: 140 },
      { fromRank: 25, toRank: 32, points: 120 },
      { fromRank: 33, toRank: 0, points: 100 },
    ],
  },
  {
    name: "180 max (13/14 Open Qualifier)",
    description: "Used for some 13/14 Open qualifier divisions last season.",
    bands: [
      { fromRank: 1, toRank: 1, points: 180 },
      { fromRank: 2, toRank: 2, points: 175 },
      { fromRank: 3, toRank: 4, points: 170 },
      { fromRank: 5, toRank: 8, points: 155 },
      { fromRank: 9, toRank: 16, points: 140 },
      { fromRank: 17, toRank: 24, points: 120 },
      { fromRank: 25, toRank: 32, points: 100 },
      { fromRank: 33, toRank: 0, points: 80 },
    ],
  },
  {
    name: "175 max (National, 14 Open)",
    description: "Used for a national-level (not quite qualifier-level) 14 Open event.",
    bands: [
      { fromRank: 1, toRank: 1, points: 175 },
      { fromRank: 2, toRank: 2, points: 170 },
      { fromRank: 3, toRank: 4, points: 165 },
      { fromRank: 5, toRank: 8, points: 150 },
      { fromRank: 9, toRank: 16, points: 140 },
      { fromRank: 17, toRank: 24, points: 115 },
      { fromRank: 25, toRank: 32, points: 95 },
      { fromRank: 33, toRank: 0, points: 75 },
    ],
  },
  {
    name: "170 max (USA/2nd Qualifier)",
    description: "Used for a lot of qualifier USA (2nd) divisions last season.",
    bands: [
      { fromRank: 1, toRank: 1, points: 170 },
      { fromRank: 2, toRank: 2, points: 165 },
      { fromRank: 3, toRank: 4, points: 160 },
      { fromRank: 5, toRank: 8, points: 150 },
      { fromRank: 9, toRank: 16, points: 140 },
      { fromRank: 17, toRank: 24, points: 120 },
      { fromRank: 25, toRank: 32, points: 90 },
      { fromRank: 33, toRank: 0, points: 75 },
    ],
  },
  {
    name: "165 max",
    description: "Qualifier tier, max 165 -- interpolated midway between the 170 max and 160 max tiers (no source screenshot).",
    bands: [
      { fromRank: 1, toRank: 1, points: 165 },
      { fromRank: 2, toRank: 2, points: 160 },
      { fromRank: 3, toRank: 4, points: 150 },
      { fromRank: 5, toRank: 8, points: 140 },
      { fromRank: 9, toRank: 16, points: 130 },
      { fromRank: 17, toRank: 24, points: 110 },
      { fromRank: 25, toRank: 32, points: 85 },
      { fromRank: 33, toRank: 0, points: 70 },
    ],
  },
  {
    name: "160 max",
    description: "Qualifier tier, max 160.",
    bands: [
      { fromRank: 1, toRank: 1, points: 160 },
      { fromRank: 2, toRank: 2, points: 155 },
      { fromRank: 3, toRank: 4, points: 145 },
      { fromRank: 5, toRank: 8, points: 135 },
      { fromRank: 9, toRank: 16, points: 125 },
      { fromRank: 17, toRank: 24, points: 100 },
      { fromRank: 25, toRank: 32, points: 80 },
      { fromRank: 33, toRank: 0, points: 60 },
    ],
  },
  {
    name: "150 max",
    description: "Qualifier tier, max 150 -- interpolated from the 160 max tier's curve (no source screenshot).",
    bands: [
      { fromRank: 1, toRank: 1, points: 150 },
      { fromRank: 2, toRank: 2, points: 145 },
      { fromRank: 3, toRank: 4, points: 135 },
      { fromRank: 5, toRank: 8, points: 125 },
      { fromRank: 9, toRank: 16, points: 115 },
      { fromRank: 17, toRank: 24, points: 95 },
      { fromRank: 25, toRank: 32, points: 75 },
      { fromRank: 33, toRank: 0, points: 60 },
    ],
  },
  {
    name: "140 max (Regional)",
    description: "Used for a lot of regional-level events last season.",
    bands: [
      { fromRank: 1, toRank: 1, points: 140 },
      { fromRank: 2, toRank: 2, points: 135 },
      { fromRank: 3, toRank: 4, points: 125 },
      { fromRank: 5, toRank: 8, points: 100 },
      { fromRank: 9, toRank: 16, points: 75 },
      { fromRank: 17, toRank: 0, points: 50 },
    ],
  },
  {
    name: "130 max (Lower Regional)",
    description: "Used for slightly lower regional-level events last season.",
    bands: [
      { fromRank: 1, toRank: 1, points: 130 },
      { fromRank: 2, toRank: 2, points: 125 },
      { fromRank: 3, toRank: 4, points: 115 },
      { fromRank: 5, toRank: 8, points: 100 },
      { fromRank: 9, toRank: 24, points: 75 },
      { fromRank: 25, toRank: 0, points: 50 },
    ],
  },
  {
    name: "120 max",
    description: "Regional tier, max 120 -- interpolated from the 130 max tier's curve (no source screenshot).",
    bands: [
      { fromRank: 1, toRank: 1, points: 120 },
      { fromRank: 2, toRank: 2, points: 115 },
      { fromRank: 3, toRank: 4, points: 105 },
      { fromRank: 5, toRank: 8, points: 90 },
      { fromRank: 9, toRank: 24, points: 70 },
      { fromRank: 25, toRank: 0, points: 45 },
    ],
  },
  {
    name: "110 max",
    description: "Regional tier, max 110 -- interpolated from the 120 max tier's curve (no source screenshot).",
    bands: [
      { fromRank: 1, toRank: 1, points: 110 },
      { fromRank: 2, toRank: 2, points: 105 },
      { fromRank: 3, toRank: 4, points: 95 },
      { fromRank: 5, toRank: 8, points: 80 },
      { fromRank: 9, toRank: 24, points: 65 },
      { fromRank: 25, toRank: 0, points: 40 },
    ],
  },
  {
    name: "100 max",
    description: "Regional tier, max 100 -- interpolated from the 110 max tier's curve (no source screenshot).",
    bands: [
      { fromRank: 1, toRank: 1, points: 100 },
      { fromRank: 2, toRank: 2, points: 95 },
      { fromRank: 3, toRank: 4, points: 85 },
      { fromRank: 5, toRank: 8, points: 70 },
      { fromRank: 9, toRank: 24, points: 60 },
      { fromRank: 25, toRank: 0, points: 35 },
    ],
  },
];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  for (const seed of TEMPLATES) {
    const maxPoints = Math.max(...seed.bands.map((b) => b.points));

    const template = await prisma.pointTemplate.upsert({
      where: { name: seed.name },
      update: { description: seed.description, maxPoints, isAnchorTemplate: false },
      create: {
        name: seed.name,
        description: seed.description,
        maxPoints,
        isAnchorTemplate: false,
      },
    });

    await prisma.pointTemplateBand.deleteMany({ where: { pointTemplateId: template.id } });
    await prisma.pointTemplateBand.createMany({
      data: seed.bands.map((b) => ({ ...b, pointTemplateId: template.id })),
    });

    console.log(`Seeded "${seed.name}" (${seed.bands.length} bands, max ${maxPoints}).`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
