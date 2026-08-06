import { prisma } from "@/lib/prisma";
import type { DivisionTierLabel, DivisionGender } from "@/generated/prisma/enums";
import { decodeAesTeamCode, isAesTeamCodeParseError, divisionGenderFromTeamCodeGender } from "./aesTeamCode";
import { isDivisionLabelParseError, parseAgeGroupLabel } from "./divisionLabel";
import { parseAesTeamNameField } from "./teamNameField";
import { computeLineageKey } from "./lineageKey";

type RowInput = {
  id: string;
  teamCodeRaw: string;
  ageGroupLabelRaw: string;
  teamNameRaw: string;
  rankRaw: string;
  overrideDivisionId: string | null;
  overrideClubId: string | null;
  overrideTeamId: string | null;
  overrideClubName: string | null;
};

type DivisionRef = {
  id: string;
  name: string;
  ageGroup: number;
  gender: DivisionGender;
  tierLabel: DivisionTierLabel;
  tierLevel: string | null;
};
type RegionRef = { id: string; code: string };
type TeamSeasonRef = { teamId: string; externalTeamCode: string | null; ageGroup: number };
type TeamRef = { id: string; lineageKey: string | null };
type ClubRef = {
  id: string;
  externalCode: string | null;
  regionId: string | null;
  mergedIntoClubId: string | null;
};

type ResolveContext = {
  // A structural key (ageGroup/gender/tierLabel/tierLevel) can legitimately collide
  // across two DIFFERENT real divisions within one event when neither's label carries
  // a recognized tier keyword -- both then default to OPEN. Confirmed against a real
  // event: TM2's "18 Championship" (bracket final finishes) and "18/17 League"
  // (season-long league standings, see tm2Standings.ts) both parse to age 18/OPEN,
  // since neither "Championship" nor "League" is in TIER_KEYWORD_MAP. So this maps to
  // every existing division sharing that signature (usually just one), and resolveRow
  // disambiguates by exact label-text match only when there's more than one --
  // keeping the normal case (reuse a division across imports even if the wording of
  // its tier varies, e.g. "National" vs "Premier") working exactly as before.
  divisionByKey: Map<string, DivisionRef[]>;
  regionByCode: Map<string, RegionRef>;
  teamSeasonByExternalCode: Map<string, TeamSeasonRef>;
  // A lineageKey is NOT enough on its own to mean "the same team" -- a club fields a
  // different roster per age group, and it's routine for e.g. "team 1" at 14u and
  // "team 1" at 17u to share a code+teamNumber while being two unrelated teams. So
  // this maps to every team sharing that lineageKey, and teamSeasonByTeamId (below)
  // is consulted to pick the one that's actually the same age-group team this season
  // (or hasn't claimed a season slot yet) -- never one already enrolled at a
  // different age. See docs/plan.md Phase 2 postmortem on the "TAV 14 Black merged
  // into 4 unrelated teams" bug this fixes.
  teamsByLineageKey: Map<string, TeamRef[]>;
  teamSeasonByTeamId: Map<string, TeamSeasonRef>;
  clubsByExternalCode: Map<string, ClubRef[]>;
  existingFinishByKey: Map<string, string>;
  claimedKeys: Set<string>;
};

function divisionKeyOf(ageGroup: number, gender: string, tierLabel: string, tierLevel: string | null): string {
  return `${ageGroup}|${gender}|${tierLabel}|${tierLevel ?? ""}`;
}

// Shared with commit.ts, which writes a REGION_MISMATCH AuditFlag for any row
// carrying one of these messages -- keep these two in sync with the escalate(...)
// call sites below rather than re-deriving the prefixes independently.
const REGION_ISSUE_PREFIXES = ["Region code", "Region in team name"];

export function isRegionIssueMessage(message: string): boolean {
  return REGION_ISSUE_PREFIXES.some((p) => message.startsWith(p));
}

/**
 * Resolves every ImportRow in a batch to a Division/Club/Team (existing, new, or
 * ambiguous) and assigns a status. Re-runnable/idempotent -- admin overrides are
 * read first and short-circuit the corresponding auto-match, so a manual pin
 * survives repeated re-resolves. See docs/plan.md Phase 2 for the full algorithm.
 */
export async function resolveImportBatch(batchId: string): Promise<void> {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { event: true, files: { include: { rows: true } } },
  });

  const divisions = await prisma.division.findMany({ where: { eventId: batch.eventId } });
  const regions = await prisma.region.findMany();
  const teamSeasons = await prisma.teamSeason.findMany({ where: { seasonId: batch.event.seasonId } });
  const existingFinishes = await prisma.teamFinish.findMany({
    where: { division: { eventId: batch.eventId } },
  });

  const allRows = batch.files.flatMap((f) => f.rows);

  // Decode every row's team code up front, purely to collect the small set of club
  // codes / lineage keys this batch actually references -- lets the club/team
  // lookups below be scoped to just this batch instead of the whole system's
  // history, which otherwise grows unbounded as more seasons/events accumulate and
  // was the dominant cost (and CPU spike) of a Resolve pass. decodeAesTeamCode is
  // pure/cheap and re-run per row in resolveRow below; recomputing it here rather
  // than threading the decoded value through is a deliberate simplicity trade-off
  // over the (already small, and one-time) cost of decoding twice.
  const neededClubCodes = new Set<string>();
  const neededLineageKeys = new Set<string>();
  for (const row of allRows) {
    const decoded = decodeAesTeamCode(row.teamCodeRaw);
    if (isAesTeamCodeParseError(decoded)) continue;
    neededClubCodes.add(decoded.clubExternalCode);
    // Gender defaults to GIRLS on an unrecognized code char, matching resolveRow's own
    // effectiveGender fallback below -- kept in sync so the prefetch always covers the
    // lineageKey resolveRow will actually look up.
    const gender = divisionGenderFromTeamCodeGender(decoded.gender) ?? "GIRLS";
    neededLineageKeys.add(
      computeLineageKey(decoded.clubExternalCode, decoded.regionCode, decoded.teamNumber, gender),
    );
  }

  const teamsWithLineage = neededLineageKeys.size
    ? await prisma.team.findMany({ where: { lineageKey: { in: [...neededLineageKeys] } } })
    : [];
  const clubs = neededClubCodes.size
    ? await prisma.club.findMany({ where: { externalCode: { in: [...neededClubCodes] } } })
    : [];

  const divisionByKey = new Map<string, DivisionRef[]>();
  for (const d of divisions) {
    const key = divisionKeyOf(d.ageGroup, d.gender, d.tierLabel, d.tierLevel);
    const group = divisionByKey.get(key) ?? [];
    group.push(d);
    divisionByKey.set(key, group);
  }

  const regionByCode = new Map<string, RegionRef>();
  for (const r of regions) regionByCode.set(r.code.toLowerCase(), r);

  const teamSeasonByExternalCode = new Map<string, TeamSeasonRef>();
  const teamSeasonByTeamId = new Map<string, TeamSeasonRef>();
  for (const ts of teamSeasons) {
    if (ts.externalTeamCode) teamSeasonByExternalCode.set(ts.externalTeamCode.toLowerCase(), ts);
    teamSeasonByTeamId.set(ts.teamId, ts);
  }

  // Returning teams that haven't been enrolled this season yet still resolve by
  // lineageKey (same program, prior season) -- not just teams already in this season.
  // Multiple teams can share a lineageKey (different age-group rosters, see the
  // ResolveContext comment above) so this is one-to-many, not one-to-one.
  const teamsByLineageKey = new Map<string, TeamRef[]>();
  for (const t of teamsWithLineage) {
    if (!t.lineageKey) continue;
    const list = teamsByLineageKey.get(t.lineageKey) ?? [];
    list.push(t);
    teamsByLineageKey.set(t.lineageKey, list);
  }

  const clubsByExternalCode = new Map<string, ClubRef[]>();
  for (const c of clubs) {
    if (!c.externalCode) continue;
    const key = c.externalCode.toLowerCase();
    const list = clubsByExternalCode.get(key) ?? [];
    list.push(c);
    clubsByExternalCode.set(key, list);
  }

  const existingFinishByKey = new Map<string, string>();
  for (const f of existingFinishes) existingFinishByKey.set(`${f.divisionId}:${f.teamId}`, f.id);

  const ctx: ResolveContext = {
    divisionByKey,
    regionByCode,
    teamSeasonByExternalCode,
    teamsByLineageKey,
    teamSeasonByTeamId,
    clubsByExternalCode,
    existingFinishByKey,
    claimedKeys: new Set(),
  };

  const results = allRows.map((row) => ({ id: row.id, data: resolveRow(row, ctx) }));

  await prisma.$transaction(
    results.map((r) => prisma.importRow.update({ where: { id: r.id }, data: r.data })),
  );

  const summaryJson = summarize(results.map((r) => r.data));
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: "RESOLVED", summaryJson },
  });
}

function resolveRow(row: RowInput, ctx: ResolveContext) {
  const messages: string[] = [];
  let status: "OK" | "WARNING" | "ERROR" = "OK";
  const escalate = (level: "WARNING" | "ERROR", message: string) => {
    messages.push(message);
    if (level === "ERROR") status = "ERROR";
    else if (status !== "ERROR") status = "WARNING";
  };

  const decoded = decodeAesTeamCode(row.teamCodeRaw);
  if (isAesTeamCodeParseError(decoded)) {
    return {
      status: "ERROR" as const,
      messages: [`Could not decode team code "${row.teamCodeRaw}": ${decoded.reason}`],
    };
  }

  const label = parseAgeGroupLabel(row.ageGroupLabelRaw);
  if (isDivisionLabelParseError(label)) {
    return {
      status: "ERROR" as const,
      messages: [`Could not parse division label "${row.ageGroupLabelRaw}": ${label.reason}`],
    };
  }
  if (label.tierWasDefaulted) {
    escalate(
      "WARNING",
      `No tier keyword found in "${row.ageGroupLabelRaw}" — defaulted to Open, please verify.`,
    );
  }

  // Gender: the team's own code is authoritative (structured data), not the label's
  // optional "B"/"G" prefix -- the label is only a cross-check. An unrecognized code
  // char (not seen in practice so far) defaults to GIRLS, matching every division
  // imported before this field existed, flagged so an admin can verify rather than
  // silently guessing.
  const rowGender = divisionGenderFromTeamCodeGender(decoded.gender);
  if (!rowGender) {
    escalate(
      "WARNING",
      `Unrecognized gender code "${decoded.gender}" in team code "${row.teamCodeRaw}" — defaulted to Girls, please verify.`,
    );
  } else if (label.genderFromLabel && label.genderFromLabel !== rowGender) {
    escalate(
      "WARNING",
      `Gender in division label ("${label.genderFromLabel}") doesn't match team code gender ("${rowGender}").`,
    );
  }
  const effectiveGender: DivisionGender = rowGender ?? "GIRLS";

  const nameField = parseAesTeamNameField(row.teamNameRaw);

  const rank = Number(row.rankRaw);
  if (!Number.isFinite(rank) || rank <= 0) {
    escalate("ERROR", `Rank "${row.rankRaw}" is not a valid positive number.`);
  }

  // Region (cross-check only -- an unresolved/mismatched code is a WARNING, never a
  // hard blocker, since AES's region codes aren't fully reconciled with USAV's
  // official codes for every region. See docs/domain-notes.md.
  const region = ctx.regionByCode.get(decoded.regionCode);
  if (!region) {
    escalate("WARNING", `Region code "${decoded.regionCode}" not found among known Regions.`);
  } else if (
    nameField.regionCodeFromName &&
    nameField.regionCodeFromName.toLowerCase() !== decoded.regionCode
  ) {
    escalate(
      "WARNING",
      `Region in team name ("${nameField.regionCodeFromName}") doesn't match team code region ("${decoded.regionCode}").`,
    );
  }

  // Division
  let divisionMatchType: "EXISTING" | "NEW";
  let matchedDivisionId: string | null = null;
  let effectiveDivisionKey: string;
  if (row.overrideDivisionId) {
    divisionMatchType = "EXISTING";
    matchedDivisionId = row.overrideDivisionId;
    effectiveDivisionKey = `id:${row.overrideDivisionId}`;
  } else {
    const key = divisionKeyOf(label.ageGroup, effectiveGender, label.tierLabel, label.tierLevel);
    const candidates = ctx.divisionByKey.get(key) ?? [];
    const rawLabel = row.ageGroupLabelRaw.trim().toLowerCase();
    const existing =
      candidates.length <= 1
        ? (candidates[0] ?? null)
        : (candidates.find((d) => d.name.trim().toLowerCase() === rawLabel) ?? null);
    if (candidates.length > 1 && !existing) {
      escalate(
        "WARNING",
        `Multiple existing divisions share this age/tier signature and none match label "${row.ageGroupLabelRaw}" exactly -- creating a separate division rather than guessing.`,
      );
    }
    if (existing) {
      divisionMatchType = "EXISTING";
      matchedDivisionId = existing.id;
      effectiveDivisionKey = `id:${existing.id}`;
    } else {
      divisionMatchType = "NEW";
      // Keyed by the raw label text, not the structural (age, tier, level) key --
      // the Division this creates is named verbatim from the CSV (see commit.ts), so
      // grouping should match on the same text rather than an internal guess that
      // could quietly merge two differently-worded-but-same-guessed-tier labels.
      effectiveDivisionKey = `new:label:${row.ageGroupLabelRaw.trim().toLowerCase()}`;
    }
  }

  // Club
  let clubMatchType: "EXISTING" | "NEW" | "AMBIGUOUS";
  let matchedClubId: string | null = null;
  if (row.overrideClubId) {
    clubMatchType = "EXISTING";
    matchedClubId = row.overrideClubId;
  } else {
    const candidates = ctx.clubsByExternalCode.get(decoded.clubExternalCode) ?? [];
    if (region) {
      const inRegion = candidates.filter((c) => c.regionId === region.id);
      if (inRegion.length === 1) {
        clubMatchType = "EXISTING";
        matchedClubId = inRegion[0].id;
        if (inRegion[0].mergedIntoClubId) {
          matchedClubId = inRegion[0].mergedIntoClubId;
          messages.push(
            `Club code "${decoded.clubExternalCode}" belongs to a club that was merged -- resolved to the surviving club.`,
          );
        }
      } else if (inRegion.length > 1) {
        clubMatchType = "AMBIGUOUS";
        escalate(
          "ERROR",
          `Club code "${decoded.clubExternalCode}" matches multiple clubs under region "${decoded.regionCode}" — resolve manually.`,
        );
      } else if (candidates.length > 0) {
        clubMatchType = "AMBIGUOUS";
        escalate(
          "ERROR",
          `Club code "${decoded.clubExternalCode}" exists but not under region "${decoded.regionCode}" — resolve manually.`,
        );
      } else {
        clubMatchType = "NEW";
      }
    } else if (candidates.length === 1) {
      clubMatchType = "EXISTING";
      matchedClubId = candidates[0].mergedIntoClubId ?? candidates[0].id;
      escalate(
        "WARNING",
        `Region unresolved; matched club "${decoded.clubExternalCode}" by code alone.`,
      );
      if (candidates[0].mergedIntoClubId) {
        messages.push(
          `Club code "${decoded.clubExternalCode}" belongs to a club that was merged -- resolved to the surviving club.`,
        );
      }
    } else if (candidates.length > 1) {
      clubMatchType = "AMBIGUOUS";
      escalate(
        "ERROR",
        `Club code "${decoded.clubExternalCode}" is ambiguous across ${candidates.length} clubs and its region could not be resolved — resolve manually.`,
      );
    } else {
      clubMatchType = "NEW";
    }
  }
  if (clubMatchType === "NEW" && !row.overrideClubName) {
    escalate(
      "WARNING",
      `New club code "${decoded.clubExternalCode}" needs an admin-supplied name before commit.`,
    );
  }

  // Team
  let teamMatchType: "EXISTING" | "NEW";
  let matchedTeamId: string | null = null;
  const lineageKey = computeLineageKey(
    decoded.clubExternalCode,
    decoded.regionCode,
    decoded.teamNumber,
    effectiveGender,
  );
  if (row.overrideTeamId) {
    teamMatchType = "EXISTING";
    matchedTeamId = row.overrideTeamId;
  } else {
    const bySeason = ctx.teamSeasonByExternalCode.get(row.teamCodeRaw.trim().toLowerCase());
    if (bySeason) {
      teamMatchType = "EXISTING";
      matchedTeamId = bySeason.teamId;
    } else {
      // A lineageKey can have multiple candidate teams (different age-group
      // rosters sharing a code+teamNumber). Prefer one already enrolled THIS
      // season at the SAME age group (genuinely the same team); otherwise fall
      // back to one not yet enrolled this season at all (a returning team newly
      // aging into this code). Never match a candidate already enrolled this
      // season at a *different* age -- that's a different real team. Compared
      // against this TEAM's own decoded age (decoded.ageGroup), not the division's
      // nominal age (label.ageGroup) -- those differ for a team playing up in a
      // combined/mismatched division, and it's the team's own age that identifies it.
      const candidates = ctx.teamsByLineageKey.get(lineageKey) ?? [];
      const sameAgeMatch = candidates.find(
        (t) => ctx.teamSeasonByTeamId.get(t.id)?.ageGroup === decoded.ageGroup,
      );
      const unenrolledMatch = candidates.find((t) => !ctx.teamSeasonByTeamId.has(t.id));
      const byLineage = sameAgeMatch ?? unenrolledMatch ?? null;
      if (byLineage) {
        teamMatchType = "EXISTING";
        matchedTeamId = byLineage.id;
      } else {
        teamMatchType = "NEW";
      }
    }
  }

  // Age-scoped, matching commit.ts's own new-team grouping (lineageKey alone would
  // incorrectly treat a club's two different-age squads sharing a team-number as
  // "the same team" whenever they land in the same division -- e.g. two legitimately
  // different teams both competing in one combined-age bracket).
  const effectiveTeamKey = matchedTeamId ? `id:${matchedTeamId}` : `new:${lineageKey}|${decoded.ageGroup}`;

  // Duplicate-in-batch: two rows collapsing onto the same team+division is an
  // error; same-rank ties across *different* teams are normal and unaffected.
  const dupeKey = `${effectiveDivisionKey}::${effectiveTeamKey}`;
  if (ctx.claimedKeys.has(dupeKey)) {
    escalate(
      "ERROR",
      "Duplicate: another row in this import already resolves to the same team + division.",
    );
  } else {
    ctx.claimedKeys.add(dupeKey);
  }

  // Re-import idempotency: an existing finish is expected/normal, not a problem --
  // commit will update it rather than erroring.
  let existingTeamFinishId: string | null = null;
  if (matchedDivisionId && matchedTeamId) {
    const finishId = ctx.existingFinishByKey.get(`${matchedDivisionId}:${matchedTeamId}`);
    if (finishId) {
      existingTeamFinishId = finishId;
      messages.push(`A finish already exists for this team in this division — commit will update it to rank ${row.rankRaw}.`);
    }
  }

  return {
    parsedRank: Number.isFinite(rank) ? rank : null,
    parsedAgeGroup: label.ageGroup,
    parsedTeamAgeGroup: decoded.ageGroup,
    parsedTierLabel: label.tierLabel,
    parsedTierLevel: label.tierLevel,
    tierWasDefaulted: label.tierWasDefaulted,
    parsedGender: decoded.gender,
    parsedDivisionGender: effectiveGender,
    parsedClubExternalCode: decoded.clubExternalCode,
    parsedTeamNumber: decoded.teamNumber,
    parsedRegionCodeFromCode: decoded.regionCode,
    parsedRegionCodeFromName: nameField.regionCodeFromName,
    parsedTiebreakOrder: nameField.tiebreakOrder,
    teamNameClean: nameField.cleanName,
    status,
    messages,
    divisionMatchType,
    matchedDivisionId,
    clubMatchType,
    matchedClubId,
    teamMatchType,
    matchedTeamId,
    existingTeamFinishId,
  };
}

function summarize(rows: { status?: "OK" | "WARNING" | "ERROR" }[]) {
  const counts = { ok: 0, warning: 0, error: 0 };
  for (const r of rows) {
    if (r.status === "OK") counts.ok += 1;
    else if (r.status === "WARNING") counts.warning += 1;
    else if (r.status === "ERROR") counts.error += 1;
  }
  return counts;
}
