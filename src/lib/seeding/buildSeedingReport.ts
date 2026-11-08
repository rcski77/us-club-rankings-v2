import { prisma } from "@/lib/prisma";
import { getLatestTeamRatings, type LatestRating } from "@/lib/rating/latestRatings";
import { partitionGenderForDivision, type RankingGender } from "@/lib/teamGender";
import { decodeAesTeamCode, isAesTeamCodeParseError } from "@/lib/import/aesTeamCode";
import type { RatingEngine } from "@/generated/prisma/enums";
import type { TeamListRow } from "./parseTeamListXlsx";
import { THIN_MATCH_THRESHOLD, averageRank, divisionAgeFromName, enginesDisagree } from "./pure";
import { computeLineageKey } from "@/lib/import/lineageKey";
import { matchTeamCodes, type CodeMatch } from "./matchTeams";
import type { SeedingDivisionReport, SeedingFlag, SeedingReport, SeedingTeam } from "./types";

const ENGINES: RatingEngine[] = ["COLLEY", "ELO", "MASSEY"];
type EngineRanks = { COLLEY?: LatestRating; ELO?: LatestRating; MASSEY?: LatestRating };

async function loadRatings(
  teamIds: string[],
  genderByTeam: Map<string, RankingGender>,
  seasonId: string,
): Promise<Map<string, EngineRanks>> {
  const out = new Map<string, EngineRanks>();
  const genders: RankingGender[] = ["GIRLS", "BOYS"];
  const jobs = genders.flatMap((gender) => {
    const ids = teamIds.filter((id) => genderByTeam.get(id) === gender);
    if (ids.length === 0) return [];
    return ENGINES.map(async (engine) => ({ engine, rows: await getLatestTeamRatings(ids, seasonId, gender, engine) }));
  });
  for (const { engine, rows } of await Promise.all(jobs)) {
    for (const r of rows) {
      const entry = out.get(r.teamId) ?? {};
      entry[engine] = r;
      out.set(r.teamId, entry);
    }
  }
  return out;
}

export type BuildSeedingReportInput = { rows: TeamListRow[]; eventId: string };

export async function buildSeedingReport({ rows, eventId }: BuildSeedingReportInput): Promise<SeedingReport> {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { name: true, startDate: true, seasonId: true, season: { select: { label: true, startDate: true } } },
  });
  const seasonId = event.seasonId;

  const [matches, priorSeasons] = await Promise.all([
    matchTeamCodes(
      rows.map((r) => r.code),
      seasonId,
    ),
    prisma.season.findMany({
      where: { startDate: { lt: event.season.startDate } },
      orderBy: { startDate: "desc" },
      take: 3,
      select: { id: true },
    }),
  ]);

  const matchedTeams = [...matches.values()].flatMap((m) => (m.team ? [m.team] : []));
  const teamIds = [...new Set(matchedTeams.map((t) => t.teamId))];
  const genderByTeam = new Map(matchedTeams.map((t) => [t.teamId, partitionGenderForDivision(t.gender)] as const));

  const [currentRatings, npsRows, matchRows] = await Promise.all([
    loadRatings(teamIds, genderByTeam, seasonId),
    prisma.rankingResult.findMany({
      where: { seasonId, teamId: { in: teamIds } },
      select: { teamId: true, rank: true, totalPoints: true },
    }),
    prisma.match.findMany({
      where: {
        event: { seasonId },
        ...(event.startDate ? { matchDate: { lt: event.startDate } } : {}),
        OR: [{ teamAId: { in: teamIds } }, { teamBId: { in: teamIds } }],
      },
      select: { teamAId: true, teamBId: true, matchDate: true },
    }),
  ]);

  // Prior-season fallback for teams with nothing rated this season. A team code is a slot
  // in the club's program, not a roster: last year's players moved UP to this year's team.
  // So a 13s team's best prior evidence is last year's 12s team of the same club + team
  // number (same lineage key, age - 1), never last year's 13s team under the same code.
  // The feeder is searched across the few most recent earlier seasons, newest first (the
  // immediately preceding season can be an empty/utility season with no ratings).
  const priorRatings = new Map<string, EngineRanks>(); // keyed by this season's teamId
  const feederLabel = new Map<string, string>(); // this season's teamId -> "Name (12s, 2025-2026)"
  const unrated = new Set(teamIds.filter((id) => !currentRatings.has(id)));
  if (unrated.size > 0 && priorSeasons.length > 0) {
    const priorIds = priorSeasons.map((s) => s.id);
    const needs = new Map<string, { key: string; feederAge: number; gender: RankingGender }>();
    for (const [code, m] of matches) {
      if (!m.team || !unrated.has(m.team.teamId)) continue;
      const decoded = decodeAesTeamCode(code);
      if (isAesTeamCodeParseError(decoded)) continue;
      needs.set(m.team.teamId, {
        key: computeLineageKey(decoded.clubExternalCode, decoded.regionCode, decoded.teamNumber, m.team.gender),
        feederAge: (m.team.ageGroup ?? decoded.ageGroup) - 1,
        gender: partitionGenderForDivision(m.team.gender),
      });
    }
    const feederCandidates = needs.size
      ? await prisma.team.findMany({
          where: { lineageKey: { in: [...new Set([...needs.values()].map((n) => n.key))] } },
          select: {
            id: true,
            name: true,
            lineageKey: true,
            seasons: {
              where: { seasonId: { in: priorIds } },
              select: { seasonId: true, ageGroup: true, season: { select: { label: true, startDate: true } } },
            },
          },
        })
      : [];
    // teamId -> feeder (team, season) pairs to rate, newest season first.
    const feederPlan = new Map<string, { feederId: string; seasonId: string; ageGroup: number; name: string; label: string }[]>();
    for (const [teamId, need] of needs) {
      const options = feederCandidates
        .filter((c) => c.lineageKey === need.key)
        .flatMap((c) =>
          c.seasons
            .filter((s) => s.ageGroup === need.feederAge)
            .map((s) => ({
              feederId: c.id,
              seasonId: s.seasonId,
              ageGroup: s.ageGroup,
              name: c.name,
              label: s.season.label,
              start: s.season.startDate.getTime(),
            })),
        )
        .sort((a, b) => b.start - a.start);
      if (options.length > 0) feederPlan.set(teamId, options);
    }
    // Rate the feeders, one season at a time (newest first), skipping teams already resolved.
    for (const seasonId of priorIds) {
      const todo = [...feederPlan.entries()].filter(([teamId]) => !priorRatings.has(teamId));
      const feeders = todo.flatMap(([teamId, opts]) => {
        const o = opts.find((x) => x.seasonId === seasonId);
        return o ? [{ teamId, ...o }] : [];
      });
      if (feeders.length === 0) continue;
      const gendersByFeeder = new Map(feeders.map((f) => [f.feederId, needs.get(f.teamId)!.gender] as const));
      const rated = await loadRatings([...gendersByFeeder.keys()], gendersByFeeder, seasonId);
      for (const f of feeders) {
        const ranks = rated.get(f.feederId);
        if (!ranks) continue;
        priorRatings.set(f.teamId, ranks);
        feederLabel.set(f.teamId, `${f.name} (${f.ageGroup}s, ${f.label})`);
      }
    }
  }

  const npsByTeam = new Map<string, { rank: number; points: number }>();
  for (const r of npsRows) {
    const prev = npsByTeam.get(r.teamId);
    if (!prev || r.rank < prev.rank) npsByTeam.set(r.teamId, { rank: r.rank, points: r.totalPoints });
  }

  const opponents = new Map<string, Set<string>>();
  const matchCount = new Map<string, number>();
  const lastDate = new Map<string, Date>();
  const track = (team: string, opp: string | null, date: Date | null) => {
    matchCount.set(team, (matchCount.get(team) ?? 0) + 1);
    if (opp) {
      const set = opponents.get(team) ?? new Set<string>();
      set.add(opp);
      opponents.set(team, set);
    }
    if (date && (!lastDate.get(team) || date > lastDate.get(team)!)) lastDate.set(team, date);
  };
  const idSet = new Set(teamIds);
  for (const m of matchRows) {
    if (m.teamAId && idSet.has(m.teamAId)) track(m.teamAId, m.teamBId, m.matchDate);
    if (m.teamBId && idSet.has(m.teamBId)) track(m.teamBId, m.teamAId, m.matchDate);
  }

  const codeCounts = new Map<string, number>();
  for (const r of rows) {
    const k = r.code.trim().toLowerCase();
    if (k) codeCounts.set(k, (codeCounts.get(k) ?? 0) + 1);
  }

  const byDivision = new Map<string, SeedingTeam[]>();
  let matched = 0;
  let lineageMatched = 0;
  let unmatched = 0;

  for (const row of rows) {
    const code = row.code.trim().toLowerCase();
    const match: CodeMatch = matches.get(code) ?? { status: "UNMATCHED", team: null };
    const team = match.team;
    const flags: SeedingFlag[] = [];

    if (match.status === "UNMATCHED") {
      unmatched++;
      flags.push("UNMATCHED");
    } else if (match.status === "LINEAGE") {
      lineageMatched++;
      flags.push("LINEAGE_MATCH");
    } else {
      matched++;
    }
    if ((codeCounts.get(code) ?? 0) > 1) flags.push("DUPLICATE_CODE");

    let ranks: EngineRanks | undefined;
    let ratingSource: SeedingTeam["ratingSource"] = "none";
    if (team) {
      if (currentRatings.has(team.teamId)) {
        ranks = currentRatings.get(team.teamId);
        ratingSource = "current";
      } else if (priorRatings.has(team.teamId)) {
        ranks = priorRatings.get(team.teamId);
        ratingSource = "prior";
        flags.push("PRIOR_SEASON_RATING");
      } else {
        flags.push("NO_RATING");
      }
    }

    const rankList = [ranks?.COLLEY?.rank ?? null, ranks?.ELO?.rank ?? null, ranks?.MASSEY?.rank ?? null];
    if (enginesDisagree(rankList)) flags.push("ENGINE_DISAGREEMENT");

    const played = team ? (matchCount.get(team.teamId) ?? 0) : 0;
    if (team && played < THIN_MATCH_THRESHOLD) flags.push("THIN_DATA");

    const divAge = divisionAgeFromName(row.divisionName);
    const decoded = decodeAesTeamCode(row.code);
    const teamAge = team?.ageGroup ?? (isAesTeamCodeParseError(decoded) ? null : decoded.ageGroup);
    if (divAge !== null && teamAge !== null && divAge !== teamAge) flags.push("AGE_MISMATCH");

    const nps = team ? npsByTeam.get(team.teamId) : undefined;
    const last = team ? lastDate.get(team.teamId) : undefined;

    const entry: SeedingTeam = {
      rowNumber: row.rowNumber,
      fileTeamName: row.teamName,
      fileClubName: row.clubName,
      city: row.city,
      state: row.state,
      code: row.code,
      matchStatus: match.status,
      teamId: team?.teamId ?? null,
      teamName: team?.name ?? null,
      clubName: team?.clubName ?? null,
      ageGroup: team?.ageGroup ?? null,
      ratingSource,
      ratingFromTeam: ratingSource === "prior" && team ? (feederLabel.get(team.teamId) ?? null) : null,
      colleyRank: rankList[0],
      eloRank: rankList[1],
      masseyRank: rankList[2],
      avgRank: averageRank(rankList),
      npsRank: nps?.rank ?? null,
      npsPoints: nps?.points ?? null,
      matchesPlayed: played,
      distinctOpponents: team ? (opponents.get(team.teamId)?.size ?? 0) : 0,
      lastMatchDate: last ? last.toISOString() : null,
      flags,
    };
    const list = byDivision.get(row.divisionName) ?? [];
    list.push(entry);
    byDivision.set(row.divisionName, list);
  }

  const divisions: SeedingDivisionReport[] = [...byDivision.entries()]
    .map(([name, teams]) => ({ name, teams }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return {
    eventName: event.name,
    seasonLabel: event.season.label,
    evidenceCutoff: event.startDate ? event.startDate.toISOString() : null,
    totalRows: rows.length,
    matched,
    lineageMatched,
    unmatched,
    divisions,
  };
}
