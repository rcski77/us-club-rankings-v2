import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { UsavZone } from "../src/generated/prisma/enums";

// The 40 USAV regions, per https://www.usavregions.org/ (fetched 2026-07-18).
const USAV_REGIONS: { name: string; code: string; zone: UsavZone }[] = [
  // Atlantic Zone
  { name: "Carolina", code: "CR", zone: "ATLANTIC" },
  { name: "Chesapeake", code: "CH", zone: "ATLANTIC" },
  { name: "Excelsior Empire", code: "XL", zone: "ATLANTIC" },
  { name: "Florida", code: "FL", zone: "ATLANTIC" },
  { name: "Garden Empire", code: "GE", zone: "ATLANTIC" },
  { name: "Keystone", code: "KE", zone: "ATLANTIC" },
  { name: "New England", code: "NE", zone: "ATLANTIC" },
  { name: "Old Dominion", code: "OD", zone: "ATLANTIC" },
  { name: "Palmetto", code: "PM", zone: "ATLANTIC" },
  { name: "Southern", code: "SO", zone: "ATLANTIC" },
  { name: "Western Empire", code: "WE", zone: "ATLANTIC" },
  // Border Zone
  { name: "Arizona", code: "AZ", zone: "BORDER" },
  { name: "Bayou", code: "BY", zone: "BORDER" },
  { name: "Delta", code: "DE", zone: "BORDER" },
  { name: "Gulf Coast", code: "GC", zone: "BORDER" },
  { name: "Lonestar", code: "LS", zone: "BORDER" },
  { name: "North Texas", code: "NT", zone: "BORDER" },
  { name: "Oklahoma", code: "OK", zone: "BORDER" },
  { name: "Sun Country", code: "SU", zone: "BORDER" },
  // Central Zone
  { name: "Badger", code: "BG", zone: "CENTRAL" },
  { name: "Gateway", code: "GW", zone: "CENTRAL" },
  { name: "Great Lakes", code: "GL", zone: "CENTRAL" },
  { name: "Great Plains", code: "GP", zone: "CENTRAL" },
  { name: "Heart of America", code: "HA", zone: "CENTRAL" },
  { name: "Hoosier", code: "HO", zone: "CENTRAL" },
  { name: "Iowa", code: "IA", zone: "CENTRAL" },
  { name: "Lakeshore", code: "LK", zone: "CENTRAL" },
  { name: "North Country", code: "NO", zone: "CENTRAL" },
  { name: "Ohio Valley", code: "OV", zone: "CENTRAL" },
  { name: "Pioneer", code: "PR", zone: "CENTRAL" },
  // Pacific Zone
  { name: "Alaska", code: "AK", zone: "PACIFIC" },
  { name: "Aloha", code: "AH", zone: "PACIFIC" },
  { name: "Columbia Empire", code: "CE", zone: "PACIFIC" },
  { name: "Evergreen", code: "EV", zone: "PACIFIC" },
  { name: "Intermountain", code: "IM", zone: "PACIFIC" },
  { name: "Moku O Keawe", code: "MK", zone: "PACIFIC" },
  { name: "Northern California", code: "NC", zone: "PACIFIC" },
  { name: "Puget Sound", code: "PS", zone: "PACIFIC" },
  { name: "Rocky Mountain", code: "RM", zone: "PACIFIC" },
  // USAV's own materials sometimes use "SCSN," but AES team codes always embed the
  // 2-char region code verbatim -- and every real AES sample for this region uses
  // "SC" -- so this uses "SC" to match what actually shows up in imported data,
  // matching the convention documented on Region.code in schema.prisma.
  { name: "Southern California / Southern Nevada", code: "SC", zone: "PACIFIC" },
];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  for (const region of USAV_REGIONS) {
    await prisma.region.upsert({
      where: { code: region.code },
      update: { name: region.name, zone: region.zone },
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
