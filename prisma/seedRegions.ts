import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// The 40 USAV regions, per https://www.usavregions.org/ (fetched 2026-07-18).
const USAV_REGIONS: { name: string; code: string }[] = [
  // Atlantic Zone
  { name: "Carolina", code: "CR" },
  { name: "Chesapeake", code: "CH" },
  { name: "Excelsior Empire", code: "XL" },
  { name: "Florida", code: "FL" },
  { name: "Garden Empire", code: "GE" },
  { name: "Keystone", code: "KE" },
  { name: "New England", code: "NE" },
  { name: "Old Dominion", code: "OD" },
  { name: "Palmetto", code: "PM" },
  { name: "Southern", code: "SO" },
  { name: "Western Empire", code: "WE" },
  // Border Zone
  { name: "Arizona", code: "AZ" },
  { name: "Bayou", code: "BY" },
  { name: "Delta", code: "DE" },
  { name: "Gulf Coast", code: "GC" },
  { name: "Lonestar", code: "LS" },
  { name: "North Texas", code: "NT" },
  { name: "Oklahoma", code: "OK" },
  { name: "Sun Country", code: "SU" },
  // Central Zone
  { name: "Badger", code: "BG" },
  { name: "Gateway", code: "GW" },
  { name: "Great Lakes", code: "GL" },
  { name: "Great Plains", code: "GP" },
  { name: "Heart of America", code: "HA" },
  { name: "Hoosier", code: "HO" },
  { name: "Iowa", code: "IA" },
  { name: "Lakeshore", code: "LK" },
  { name: "North Country", code: "NO" },
  { name: "Ohio Valley", code: "OV" },
  { name: "Pioneer", code: "PR" },
  // Pacific Zone
  { name: "Alaska", code: "AK" },
  { name: "Aloha", code: "AH" },
  { name: "Columbia Empire", code: "CE" },
  { name: "Evergreen", code: "EV" },
  { name: "Intermountain", code: "IM" },
  { name: "Moku O Keawe", code: "MK" },
  { name: "Northern California", code: "NC" },
  { name: "Puget Sound", code: "PS" },
  { name: "Rocky Mountain", code: "RM" },
  { name: "Southern California / Southern Nevada", code: "SCSN" },
];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  for (const region of USAV_REGIONS) {
    await prisma.region.upsert({
      where: { code: region.code },
      update: { name: region.name },
      create: region,
    });
  }

  console.log(`Seeded ${USAV_REGIONS.length} USAV regions.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
