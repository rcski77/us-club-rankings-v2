import { fetchTm2Json } from "./tm2Fetch";
import { fetchTm2EventInfo } from "./tm2Standings";
import type { AesFetchedMatch, AesMatchSetScore } from "./aesMatches";

const TM2_API_BASE = "https://tm2sign.com/api/public";

// Round/pool-bracket names aren't embedded on a match row (just numeric ids), so
// these are fetched once per division -- same two endpoints tm2Standings.ts's
// discovery already used to find the final-finishes screen -- purely to build a
// human-readable "stage" string (e.g. "Round 1 — Pool 1"), which resolveMatches.ts
// doesn't otherwise need (see aesMatches.ts's divisionAesId/divisionLabel comment:
// division is resolved from the team's own TeamFinish, never from this).
type ApiSchedulerRound = { id: number; name: string };
type ApiSchedulerPoolBracket = { id: number; name: string };

async function fetchTm2Rounds(divisionId: number): Promise<ApiSchedulerRound[]> {
  return fetchTm2Json<ApiSchedulerRound[]>(
    `${TM2_API_BASE}/scheduler-rounds?filter[event_division_id]=${divisionId}`,
  );
}

async function fetchTm2PoolBrackets(divisionId: number): Promise<ApiSchedulerPoolBracket[]> {
  return fetchTm2Json<ApiSchedulerPoolBracket[]>(
    `${TM2_API_BASE}/scheduler-pool-brackets?filter[event_division_id]=${divisionId}`,
  );
}

// TM2's scheduler-matches endpoint covers the whole event in one paginated query
// (confirmed against a real event: 2178 matches across 12 divisions, 22 pages of
// 100) -- unlike AES (no "all matches" endpoint, must walk every team's
// schedule/past) and VBSchedule (must walk every division's rounds -> pools), TM2
// needs no per-division/per-pool match fetch at all, only pagination.
type ApiSchedulerTeamRef = { id: number; alternate_identifier?: string | null; name?: string | null };
type ApiSchedulerMatch = {
  id: number;
  event_division_id: number;
  scheduler_round_id: number;
  scheduler_pool_bracket_id: number;
  winning_scheduler_team_id: number | null;
  completed_time: number | null;
  start_time: number | null;
  position_one_match_set_wins: number;
  position_two_match_set_wins: number;
  position_one_score_one: number | null;
  position_one_score_two: number | null;
  position_one_score_three: number | null;
  position_one_score_four: number | null;
  position_one_score_five: number | null;
  position_two_score_one: number | null;
  position_two_score_two: number | null;
  position_two_score_three: number | null;
  position_two_score_four: number | null;
  position_two_score_five: number | null;
  teamOne?: ApiSchedulerTeamRef | null;
  teamTwo?: ApiSchedulerTeamRef | null;
};
type ApiMatchPage = { data: ApiSchedulerMatch[]; current_page: number; last_page: number };

async function fetchTm2MatchesPage(eventId: string, page: number): Promise<ApiMatchPage> {
  return fetchTm2Json<ApiMatchPage>(
    `${TM2_API_BASE}/scheduler-matches?filter[event_id]=${encodeURIComponent(eventId)}` +
      `&include[]=teamOne&include[]=teamTwo&page=${page}`,
  );
}

export type FetchTm2MatchesResult = { matches: AesFetchedMatch[]; eventName: string };

/**
 * Fetches every completed match across a TM2 event's divisions. Result shape matches
 * `AesFetchedMatch` exactly (reused as-is, not re-declared -- same reasoning as
 * sportwrenchMatches.ts/vbscheduleMatches.ts: resolveMatches.ts's resolveAesMatches()
 * is source-agnostic despite the name), so importTm2MatchResults (commitMatches.ts)
 * can reuse the exact same resolve/commit pipeline every other source's matches
 * already go through.
 */
export async function fetchTm2MatchResults(eventId: string): Promise<FetchTm2MatchesResult> {
  const eventInfo = await fetchTm2EventInfo(eventId);

  const roundNameById = new Map<number, string>();
  const poolBracketNameById = new Map<number, string>();
  for (const division of eventInfo.divisions) {
    const [rounds, poolBrackets] = await Promise.all([
      fetchTm2Rounds(division.divisionId),
      fetchTm2PoolBrackets(division.divisionId),
    ]);
    for (const r of rounds) roundNameById.set(r.id, r.name);
    for (const p of poolBrackets) poolBracketNameById.set(p.id, p.name);
  }
  const divisionNameById = new Map(eventInfo.divisions.map((d) => [d.divisionId, d.name]));

  const matchesById = new Map<string, AesFetchedMatch>();

  let page = 1;
  let lastPage = 1;
  do {
    const result = await fetchTm2MatchesPage(eventId, page);
    lastPage = result.last_page;

    for (const m of result.data) {
      const externalMatchId = String(m.id);
      // Not yet played (no winner recorded), or a bye/no-show with no completed time.
      if (!m.winning_scheduler_team_id || !m.completed_time || matchesById.has(externalMatchId)) continue;

      const scoresA = [
        m.position_one_score_one,
        m.position_one_score_two,
        m.position_one_score_three,
        m.position_one_score_four,
        m.position_one_score_five,
      ];
      const scoresB = [
        m.position_two_score_one,
        m.position_two_score_two,
        m.position_two_score_three,
        m.position_two_score_four,
        m.position_two_score_five,
      ];
      const sets: AesMatchSetScore[] = [];
      for (let i = 0; i < scoresA.length; i++) {
        const a = scoresA[i];
        const b = scoresB[i];
        if (a == null || b == null) continue;
        sets.push({ a, b });
      }
      if (sets.length === 0) continue;

      const teamACode = m.teamOne?.alternate_identifier ?? null;
      const teamBCode = m.teamTwo?.alternate_identifier ?? null;
      const winnerCode =
        m.winning_scheduler_team_id === m.teamOne?.id
          ? teamACode
          : m.winning_scheduler_team_id === m.teamTwo?.id
            ? teamBCode
            : null;

      const stage =
        [roundNameById.get(m.scheduler_round_id), poolBracketNameById.get(m.scheduler_pool_bracket_id)]
          .filter(Boolean)
          .join(" — ") || null;

      matchesById.set(externalMatchId, {
        externalMatchId,
        divisionAesId: m.event_division_id,
        divisionLabel: divisionNameById.get(m.event_division_id) ?? "",
        teamACode,
        teamAName: m.teamOne?.name ?? "",
        teamBCode,
        teamBName: m.teamTwo?.name ?? "",
        winnerCode,
        sets,
        setsA: m.position_one_match_set_wins,
        setsB: m.position_two_match_set_wins,
        matchDate: new Date(m.completed_time * 1000),
        stage,
      });
    }

    page += 1;
  } while (page <= lastPage);

  return { matches: [...matchesById.values()], eventName: eventInfo.name };
}
