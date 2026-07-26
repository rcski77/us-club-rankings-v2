import type { AesFetchedMatch, AesMatchSetScore } from "./aesMatches";

export type MatchTeamSeasonRef = { teamId: string };

export type ResolvedMatch = {
  externalMatchId: string;
  divisionId: string;
  teamAId: string;
  teamBId: string;
  winnerTeamId: string | null;
  matchDate: Date | null;
  stage: string | null;
  setsA: number;
  setsB: number;
  setScores: AesMatchSetScore[];
};

export type SkippedMatch = { externalMatchId: string; reason: string };

/**
 * Resolves fetched AES match rows against Teams/Divisions that already exist for the
 * event -- deliberately does NOT create anything new (unlike resolve.ts's
 * TEAM_FINISHES flow), since a match import expects the event's team finishes to
 * already be imported.
 *
 * Division is resolved from the team's own already-committed TeamFinish, not by
 * re-parsing AES's division-name text -- AES's JSON standings API gives a division's
 * bare name (e.g. "13 Club"), while the CSV export's ageGroupLabel column used for
 * TEAM_FINISHES can carry a combined-age label for the same division (e.g. "12/13
 * Club", see divisionLabel.ts) if a 12u team played up into it. Re-parsing the JSON
 * API's label would then fail to match the Division the CSV import actually created.
 * Going through `divisionIdByTeamId` (built from the event's real TeamFinish rows)
 * sidesteps that mismatch entirely and is more robust generally, since it's the same
 * ground truth the ranking/rating engines already trust.
 */
export function resolveAesMatches(
  fetched: AesFetchedMatch[],
  teamSeasonByExternalCode: Map<string, MatchTeamSeasonRef>,
  divisionIdByTeamId: Map<string, string>,
): { resolved: ResolvedMatch[]; skipped: SkippedMatch[] } {
  const resolved: ResolvedMatch[] = [];
  const skipped: SkippedMatch[] = [];

  for (const m of fetched) {
    const teamA = m.teamACode ? teamSeasonByExternalCode.get(m.teamACode.toLowerCase()) : undefined;
    const teamB = m.teamBCode ? teamSeasonByExternalCode.get(m.teamBCode.toLowerCase()) : undefined;
    if (!teamA || !teamB) {
      const missing = [!teamA ? m.teamAName : null, !teamB ? m.teamBName : null].filter(Boolean).join(", ");
      skipped.push({
        externalMatchId: m.externalMatchId,
        reason: `Team(s) not resolved: ${missing} — import team finishes for this event first.`,
      });
      continue;
    }

    const divisionId = divisionIdByTeamId.get(teamA.teamId) ?? divisionIdByTeamId.get(teamB.teamId);
    if (!divisionId) {
      skipped.push({
        externalMatchId: m.externalMatchId,
        reason: `Neither team has a recorded finish for this event yet — import team finishes for this event first.`,
      });
      continue;
    }

    const winnerTeamId =
      m.winnerCode == null
        ? null
        : m.winnerCode === m.teamACode
          ? teamA.teamId
          : m.winnerCode === m.teamBCode
            ? teamB.teamId
            : null;

    resolved.push({
      externalMatchId: m.externalMatchId,
      divisionId,
      teamAId: teamA.teamId,
      teamBId: teamB.teamId,
      winnerTeamId,
      matchDate: m.matchDate,
      stage: m.stage,
      setsA: m.setsA,
      setsB: m.setsB,
      setScores: m.sets,
    });
  }

  return { resolved, skipped };
}
