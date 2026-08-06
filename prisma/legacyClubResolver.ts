import type { PrismaClient } from "../src/generated/prisma/client";
import { uniqueSlug } from "../src/lib/slug";

// Shared by every prisma/import*.ts script that reads a 7-char club code (5-char
// externalCode + 2-char region code, e.g. "afiveso" = club "afive" + region "so") out
// of the legacy workbook -- see docs/plan.md's legacy 5-year import note for how this
// format was confirmed (100% of ~1100 sampled codes across 9 sheets were exactly 7
// chars). Not a reuse of aesTeamCode.ts's decodeAesTeamCode -- that's a different
// fixed format (gender+age+club+teamNumber+region on a full team code), this is just
// the bare club+region pair.

export function decodeClubCode(code: string): { externalCode: string; regionCode: string } | null {
  const trimmed = code.trim();
  if (trimmed.length !== 7) return null;
  return {
    externalCode: trimmed.slice(0, 5).toLowerCase(),
    regionCode: trimmed.slice(5, 7).toUpperCase(),
  };
}

export type LegacyClubResolver = {
  resolveClub: (clubCode: string, nameHint?: string, stateHint?: string) => Promise<string | null>;
  clubsMatched: number;
  clubsCreated: number;
  unresolvedRegionCodes: Set<string>;
  skippedRows: string[];
};

/**
 * Builds a `resolveClub()` closure (with its own running counters/skip log, returned
 * alongside it) that resolves a 7-char legacy club code to a real Club.id -- matching
 * an existing (externalCode, regionId) row if one exists, creating a new Club
 * otherwise. Shared across import scripts so a club code resolves to the exact same
 * Club row regardless of which script processes it first.
 */
export function createLegacyClubResolver(prisma: PrismaClient): LegacyClubResolver {
  const state: LegacyClubResolver = {
    resolveClub: async () => null, // placeholder, replaced below
    clubsMatched: 0,
    clubsCreated: 0,
    unresolvedRegionCodes: new Set(),
    skippedRows: [],
  };

  const clubIdByCode = new Map<string, string>();
  let regionByCode: Map<string, { id: string; code: string }> | null = null;

  state.resolveClub = async (clubCode, nameHint, stateHint) => {
    const cached = clubIdByCode.get(clubCode);
    if (cached) return cached;

    if (!regionByCode) {
      const regions = await prisma.region.findMany();
      regionByCode = new Map(regions.map((r) => [r.code, r]));
    }

    const decoded = decodeClubCode(clubCode);
    if (!decoded) {
      state.skippedRows.push(`Malformed club code "${clubCode}" (expected 7 chars)`);
      return null;
    }

    const region = regionByCode.get(decoded.regionCode);
    if (!region) {
      state.unresolvedRegionCodes.add(decoded.regionCode);
      state.skippedRows.push(`Unresolved region code "${decoded.regionCode}" for club code "${clubCode}"`);
      return null;
    }

    const existing = await prisma.club.findUnique({
      where: { externalCode_regionId: { externalCode: decoded.externalCode, regionId: region.id } },
    });
    if (existing) {
      clubIdByCode.set(clubCode, existing.id);
      state.clubsMatched += 1;
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
    state.clubsCreated += 1;
    return created.id;
  };

  return state;
}
