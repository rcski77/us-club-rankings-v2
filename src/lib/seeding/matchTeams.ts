import { prisma } from "@/lib/prisma";
import type { DivisionGender } from "@/generated/prisma/enums";
import {
  decodeAesTeamCode,
  isAesTeamCodeParseError,
  divisionGenderFromTeamCodeGender,
} from "@/lib/import/aesTeamCode";
import { computeLineageKey } from "@/lib/import/lineageKey";

import { pickBestSeasonRow } from "./pure";

export type MatchStatus = "MATCHED" | "LINEAGE" | "UNMATCHED";

export type MatchedTeamInfo = {
  teamId: string;
  name: string;
  clubName: string | null;
  gender: DivisionGender;
  /** Age group in the report's season, if enrolled; otherwise the age of the code. */
  ageGroup: number | null;
  /** True when the team has a TeamSeason row in the report's season. */
  enrolledThisSeason: boolean;
};

export type CodeMatch = { status: MatchStatus; team: MatchedTeamInfo | null; note?: string };

/**
 * Read-only matching of file codes to existing Teams (never creates anything).
 *  1. TeamSeason.externalTeamCode equals the code (case-insensitive; stored lowercase),
 *     report season preferred then most recent.
 *  2. Lineage: decode the code -> Team.lineageKey, same-age candidate only (a club's code
 *     is the team year to year, so a candidate last seen at a different age is a
 *     different team -- same rule as resolve.ts).
 *  3. Unmatched.
 * Returns a map keyed by lowercased code. Two batched queries regardless of file size.
 */
export async function matchTeamCodes(rawCodes: string[], seasonId: string): Promise<Map<string, CodeMatch>> {
  const result = new Map<string, CodeMatch>();
  const codes = [...new Set(rawCodes.map((c) => c.trim().toLowerCase()).filter(Boolean))];
  if (codes.length === 0) return result;

  const teamSelect = {
    id: true,
    name: true,
    gender: true,
    club: { select: { name: true } },
  } as const;

  const bySeasonRows = await prisma.teamSeason.findMany({
    where: { externalTeamCode: { in: codes } },
    select: {
      externalTeamCode: true,
      seasonId: true,
      ageGroup: true,
      season: { select: { startDate: true } },
      team: { select: teamSelect },
    },
  });

  const grouped = new Map<string, typeof bySeasonRows>();
  for (const row of bySeasonRows) {
    const key = (row.externalTeamCode ?? "").toLowerCase();
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  for (const [code, rows] of grouped) {
    const best = pickBestSeasonRow(
      rows.map((r) => ({ ...r, seasonStart: r.season.startDate })),
      seasonId,
    );
    if (!best) continue;
    result.set(code, {
      status: "MATCHED",
      team: {
        teamId: best.team.id,
        name: best.team.name,
        clubName: best.team.club?.name ?? null,
        gender: best.team.gender,
        ageGroup: best.ageGroup,
        enrolledThisSeason: best.seasonId === seasonId,
      },
    });
  }

  // Lineage fallback for the rest.
  const lineageByCode = new Map<string, { key: string; age: number }>();
  for (const code of codes) {
    if (result.has(code)) continue;
    const decoded = decodeAesTeamCode(code);
    if (isAesTeamCodeParseError(decoded)) {
      result.set(code, { status: "UNMATCHED", team: null, note: decoded.reason });
      continue;
    }
    const gender = divisionGenderFromTeamCodeGender(decoded.gender) ?? "GIRLS";
    lineageByCode.set(code, {
      key: computeLineageKey(decoded.clubExternalCode, decoded.regionCode, decoded.teamNumber, gender),
      age: decoded.ageGroup,
    });
  }

  if (lineageByCode.size > 0) {
    const keys = [...new Set([...lineageByCode.values()].map((v) => v.key))];
    const candidates = await prisma.team.findMany({
      where: { lineageKey: { in: keys } },
      select: {
        ...teamSelect,
        lineageKey: true,
        seasons: {
          orderBy: { season: { startDate: "desc" } },
          select: { seasonId: true, ageGroup: true },
        },
      },
    });
    const candidatesByKey = new Map<string, typeof candidates>();
    for (const c of candidates) {
      if (!c.lineageKey) continue;
      const list = candidatesByKey.get(c.lineageKey) ?? [];
      list.push(c);
      candidatesByKey.set(c.lineageKey, list);
    }

    for (const [code, { key, age }] of lineageByCode) {
      const fit = (candidatesByKey.get(key) ?? []).find((c) => c.seasons[0]?.ageGroup === age);
      if (!fit) {
        result.set(code, { status: "UNMATCHED", team: null });
        continue;
      }
      const current = fit.seasons.find((s) => s.seasonId === seasonId);
      result.set(code, {
        status: "LINEAGE",
        team: {
          teamId: fit.id,
          name: fit.name,
          clubName: fit.club?.name ?? null,
          gender: fit.gender,
          ageGroup: current?.ageGroup ?? fit.seasons[0]?.ageGroup ?? age,
          enrolledThisSeason: !!current,
        },
      });
    }
  }

  return result;
}
