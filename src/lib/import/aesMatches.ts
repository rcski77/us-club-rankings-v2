import { fetchAes } from "./aesFetch";
import { fetchAesEventInfo, fetchAesDivisionStandings } from "./aesStandings";

const AES_API_BASE = "https://results.advancedeventsystems.com";

export type AesMatchSetScore = { a: number; b: number };

export type AesFetchedMatch = {
  externalMatchId: string;
  divisionAesId: number;
  divisionLabel: string; // same shape as aesStandings' ageGroupLabel (e.g. "14 Open")
  teamACode: string | null; // null when AES's standings never surfaced this team's code
  teamAName: string;
  teamBCode: string | null;
  teamBName: string;
  winnerCode: string | null;
  sets: AesMatchSetScore[];
  setsA: number;
  setsB: number;
  matchDate: Date | null;
  stage: string | null;
};

type ApiMatchSet = { FirstTeamScore: number | null; SecondTeamScore: number | null };
type ApiMatch = {
  MatchId: number;
  FirstTeamId: number;
  FirstTeamName?: string;
  FirstTeamWon: boolean;
  SecondTeamId: number;
  SecondTeamName?: string;
  HasScores: boolean;
  Sets?: ApiMatchSet[];
  ScheduledStartDateTime?: string | null;
};
type ApiPastScheduleEntry = { Match: ApiMatch; Play?: { FullName?: string } };

async function fetchAesTeamPastSchedule(
  aesEventId: string,
  divisionId: number,
  teamId: number,
): Promise<ApiPastScheduleEntry[]> {
  const url = `${AES_API_BASE}/api/event/${encodeURIComponent(aesEventId)}/division/${divisionId}/team/${teamId}/schedule/past`;
  const res = await fetchAes(url);
  if (!res.ok) {
    throw new Error(
      `AES past-schedule lookup failed for event "${aesEventId}" division ${divisionId} team ${teamId}: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as ApiPastScheduleEntry[];
}

export type FetchAesMatchesResult = {
  matches: AesFetchedMatch[];
  eventName: string;
};

/**
 * Fetches every completed match across an AES event's divisions. AES has no single
 * "all matches" endpoint -- results are only reachable per-team via each team's
 * "schedule/past" endpoint (the approach `AES Scraping/Match Results/
 * aes_match_results.py`, a sibling project, already proved against this same API), so
 * this fetches standings first (to get each division's team list plus each team's AES
 * numeric TeamId and structured TeamCode -- the code is what the rest of the import
 * pipeline resolves teams by, see resolve.ts) and then queries every team's past
 * schedule, de-duping by MatchId since a completed match shows up in both
 * participants' schedules.
 */
export async function fetchAesMatchResults(aesEventId: string): Promise<FetchAesMatchesResult> {
  const eventInfo = await fetchAesEventInfo(aesEventId);

  const codeByTeamId = new Map<number, string>();
  const teamsByDivision: { divisionId: number; divisionLabel: string; teamId: number }[] = [];

  for (const division of eventInfo.divisions) {
    const teams = await fetchAesDivisionStandings(aesEventId, division.divisionId);
    for (const team of teams) {
      if (team.TeamId == null) continue;
      if (team.TeamCode) codeByTeamId.set(team.TeamId, team.TeamCode);
      teamsByDivision.push({
        divisionId: division.divisionId,
        divisionLabel: team.Division?.Name ?? division.name,
        teamId: team.TeamId,
      });
    }
  }

  const matchesById = new Map<string, AesFetchedMatch>();
  for (const { divisionId, divisionLabel, teamId } of teamsByDivision) {
    const entries = await fetchAesTeamPastSchedule(aesEventId, divisionId, teamId);
    for (const entry of entries) {
      const m = entry.Match;
      const externalMatchId = String(m.MatchId);
      if (!m.HasScores || matchesById.has(externalMatchId)) continue;

      const sets = (m.Sets ?? [])
        .filter((s) => s.FirstTeamScore != null && s.SecondTeamScore != null)
        .map((s) => ({ a: s.FirstTeamScore as number, b: s.SecondTeamScore as number }));
      if (sets.length === 0) continue;

      const teamACode = codeByTeamId.get(m.FirstTeamId) ?? null;
      const teamBCode = codeByTeamId.get(m.SecondTeamId) ?? null;

      matchesById.set(externalMatchId, {
        externalMatchId,
        divisionAesId: divisionId,
        divisionLabel,
        teamACode,
        teamAName: m.FirstTeamName ?? "",
        teamBCode,
        teamBName: m.SecondTeamName ?? "",
        winnerCode: m.FirstTeamWon ? teamACode : teamBCode,
        sets,
        setsA: sets.filter((s) => s.a > s.b).length,
        setsB: sets.filter((s) => s.b > s.a).length,
        matchDate: m.ScheduledStartDateTime ? new Date(m.ScheduledStartDateTime) : null,
        stage: entry.Play?.FullName ?? null,
      });
    }
  }

  return { matches: [...matchesById.values()], eventName: eventInfo.name };
}
