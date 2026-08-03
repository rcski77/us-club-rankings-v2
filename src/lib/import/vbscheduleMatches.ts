import { fetchVbschedulePage } from "./vbscheduleFetch";
import { fetchVbscheduleEventInfo, fetchVbscheduleDivisionTeams } from "./vbscheduleStandings";
import type { AesFetchedMatch, AesMatchSetScore } from "./aesMatches";

const VBS_BASE = "https://vbschedule.com";

// VBSchedule has no single "all matches" endpoint either -- same shape of problem
// aesMatches.ts/sportwrenchMatches.ts already solved for their own platforms.
// Matches only live inside a division's individual pool/bracket pages, so this walks
// division -> rounds -> pools -> pool page's match list.
type ApiPoolRef = { id: string; type: "pool" | "bracket" };
type ApiRound = { pools: ApiPoolRef[] };
type ApiDivisionRoundsProps = { division: { name: string }; rounds: ApiRound[] };

async function fetchVbscheduleDivisionPoolIds(eventId: string, divisionId: string): Promise<string[]> {
  const page = await fetchVbschedulePage<ApiDivisionRoundsProps>(
    `${VBS_BASE}/events/${encodeURIComponent(eventId)}/division/${encodeURIComponent(divisionId)}`,
  );
  return page.props.rounds.flatMap((r) => r.pools.map((p) => p.id));
}

// teamOneScores/teamTwoScores are parallel fixed-length arrays (one slot per possible
// set, e.g. [ "25", "25", null, null, null ]) -- null slots are sets that were never
// played (the match ended in 2). teamOneSetWins/teamTwoSetWins are given directly by
// the API rather than needing to be re-derived from the scores, unlike AES/Sportwrench.
type ApiPoolMatch = {
  id: string;
  completedTime?: number | null; // epoch seconds
  startTime?: number | null;
  teamOneId: string;
  teamOneName?: string;
  teamTwoId: string;
  teamTwoName?: string;
  teamOneScores?: (string | null)[];
  teamTwoScores?: (string | null)[];
  teamOneSetWins?: number;
  teamTwoSetWins?: number;
  winningTeamId?: string | null;
};
type ApiPoolBracket = { id: string; name: string; roundName?: string | null; matches: ApiPoolMatch[] };
type ApiPoolProps = { poolBracket: ApiPoolBracket };

async function fetchVbschedulePoolMatches(eventId: string, poolId: string): Promise<ApiPoolBracket> {
  const page = await fetchVbschedulePage<ApiPoolProps>(
    `${VBS_BASE}/events/${encodeURIComponent(eventId)}/pool/${encodeURIComponent(poolId)}`,
  );
  return page.props.poolBracket;
}

export type FetchVbscheduleMatchesResult = { matches: AesFetchedMatch[]; eventName: string };

/**
 * Fetches every completed match across a VBSchedule event's divisions. Fetches
 * standings first (for each team's alternateIdentifier -- VBSchedule's team code,
 * same fixed-width AES shape, see vbscheduleStandings.ts) then, per division, walks
 * every round's pools/brackets and pulls that pool page's match list. Result shape
 * matches `AesFetchedMatch` exactly (reused as-is, not re-declared -- same reasoning
 * as sportwrenchMatches.ts: resolveMatches.ts's resolveAesMatches() is
 * source-agnostic despite the name), so importVbscheduleMatchResults
 * (commitMatches.ts) can reuse the exact same resolve/commit pipeline AES and
 * Sportwrench matches already go through.
 */
export async function fetchVbscheduleMatchResults(eventId: string): Promise<FetchVbscheduleMatchesResult> {
  const eventInfo = await fetchVbscheduleEventInfo(eventId);

  const matchesById = new Map<string, AesFetchedMatch>();

  for (const division of eventInfo.divisions) {
    const teams = await fetchVbscheduleDivisionTeams(eventId, division.divisionId);
    const codeByTeamId = new Map<string, string>();
    for (const team of teams) {
      if (team.alternateIdentifier) codeByTeamId.set(team.id, team.alternateIdentifier);
    }

    const poolIds = await fetchVbscheduleDivisionPoolIds(eventId, division.divisionId);
    for (const poolId of poolIds) {
      const pool = await fetchVbschedulePoolMatches(eventId, poolId);
      for (const m of pool.matches) {
        if (matchesById.has(m.id)) continue;
        if (!m.winningTeamId) continue; // not yet played

        const sets: AesMatchSetScore[] = [];
        const scoresA = m.teamOneScores ?? [];
        const scoresB = m.teamTwoScores ?? [];
        for (let i = 0; i < Math.max(scoresA.length, scoresB.length); i++) {
          const a = scoresA[i];
          const b = scoresB[i];
          if (a == null || b == null) continue;
          const aNum = Number(a);
          const bNum = Number(b);
          if (!Number.isFinite(aNum) || !Number.isFinite(bNum)) continue;
          sets.push({ a: aNum, b: bNum });
        }
        if (sets.length === 0) continue;

        const teamACode = codeByTeamId.get(m.teamOneId) ?? null;
        const teamBCode = codeByTeamId.get(m.teamTwoId) ?? null;
        const winnerCode = codeByTeamId.get(m.winningTeamId) ?? null;

        matchesById.set(m.id, {
          externalMatchId: m.id,
          divisionAesId: Number(division.divisionId) || 0,
          divisionLabel: division.name,
          teamACode,
          teamAName: m.teamOneName ?? "",
          teamBCode,
          teamBName: m.teamTwoName ?? "",
          winnerCode,
          sets,
          setsA: m.teamOneSetWins ?? sets.filter((s) => s.a > s.b).length,
          setsB: m.teamTwoSetWins ?? sets.filter((s) => s.b > s.a).length,
          matchDate: m.completedTime ? new Date(m.completedTime * 1000) : m.startTime ? new Date(m.startTime * 1000) : null,
          stage: [pool.roundName, pool.name].filter(Boolean).join(" — ") || null,
        });
      }
    }
  }

  return { matches: [...matchesById.values()], eventName: eventInfo.name };
}
