import { fetchSportwrench } from "./sportwrenchFetch";
import { fetchSportwrenchEventInfo, fetchSportwrenchDivisionStandings } from "./sportwrenchStandings";
import type { AesFetchedMatch, AesMatchSetScore } from "./aesMatches";

const SW_API_BASE = "https://events.sportwrench.com/api/esw";

// Sportwrench has no single "all matches" endpoint either -- same shape of problem
// aesMatches.ts already solved for AES. Its per-team detail endpoint
// (`/teams/{roster_team_id}`) carries a `matches` field, but as a JSON-encoded
// *string* (not a nested object) -- confirmed against real data (event c098ff439,
// team 279897) -- so it needs a second JSON.parse. Each match entry is from that
// team's own point of view: `match_type` says whether this team was "team1" or
// "team2", `results.set1`/`set2`/... are "team1Score-team2Score" strings, and
// `opponent_*` fields give the other side directly -- no second team lookup needed.
// De-dupe by match_id since a completed match appears in both participants' lists,
// same as AES's MatchId de-dupe.
type ApiTeamMatchResults = {
  winner?: string; // "1" | "2"
  [setKey: string]: unknown; // set1, set2, set3... each "20-25"
};
type ApiTeamMatch = {
  match_id: string;
  match_type: "team1" | "team2";
  date_start?: number; // ms epoch
  results: ApiTeamMatchResults;
  division_id?: number;
  division_short_name?: string;
  pb_name?: string; // pool/bracket name, e.g. "Div 5 Pool 1"
  round_name?: string; // e.g. "Round 1"
  opponent_team_name?: string;
  opponent_organization_code?: string;
};
// The team detail endpoint's `matches` field isn't top-level -- it's nested one
// level down, inside `results[]` (confirmed against real data: one `results` entry
// per pool/bracket the team played in, e.g. pool play and a playoff bracket are two
// separate entries, each with its own JSON-encoded `matches` string covering just
// that entry's matches).
type ApiTeamResultsEntry = { matches?: string };
type ApiTeamDetail = { results?: ApiTeamResultsEntry[] };

async function fetchSportwrenchTeamMatches(eventId: string, teamId: number): Promise<ApiTeamMatch[]> {
  const res = await fetchSportwrench(`${SW_API_BASE}/${encodeURIComponent(eventId)}/teams/${teamId}`);
  if (!res.ok) {
    throw new Error(
      `Sportwrench team lookup failed for event "${eventId}" team ${teamId}: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as ApiTeamDetail;
  const matches: ApiTeamMatch[] = [];
  for (const entry of data.results ?? []) {
    if (!entry.matches) continue;
    try {
      matches.push(...(JSON.parse(entry.matches) as ApiTeamMatch[]));
    } catch {
      // skip an unparseable entry rather than failing the whole team
    }
  }
  return matches;
}

function extractSets(results: ApiTeamMatchResults): AesMatchSetScore[] {
  const sets: AesMatchSetScore[] = [];
  for (let i = 1; ; i++) {
    const raw = results[`set${i}`];
    if (typeof raw !== "string") break;
    const [aStr, bStr] = raw.split("-");
    const a = Number(aStr);
    const b = Number(bStr);
    if (!Number.isFinite(a) || !Number.isFinite(b)) break;
    sets.push({ a, b });
  }
  return sets;
}

export type FetchSportwrenchMatchesResult = { matches: AesFetchedMatch[]; eventName: string };

/**
 * Fetches every completed match across a Sportwrench event's divisions -- fetches
 * standings first (for each team's roster_team_id + organization_code, same as
 * aesMatches.ts) then queries every team's own match-history endpoint. Result shape
 * matches `AesFetchedMatch` exactly (reused as-is, not re-declared -- resolveMatches.ts's
 * resolveAesMatches() is source-agnostic despite the name: it never reads
 * divisionAesId/divisionLabel, resolving Division via the team's own already-imported
 * TeamFinish instead), so importSportwrenchMatchResults (commitMatches.ts) can reuse
 * the exact same resolve/commit pipeline AES matches already go through.
 */
export async function fetchSportwrenchMatchResults(eventId: string): Promise<FetchSportwrenchMatchesResult> {
  const eventInfo = await fetchSportwrenchEventInfo(eventId);

  const codeByTeamId = new Map<number, string>();
  const nameByTeamId = new Map<number, string>();
  const teamIds = new Set<number>();

  for (const division of eventInfo.divisions) {
    const teams = await fetchSportwrenchDivisionStandings(eventId, division.divisionId);
    for (const team of teams) {
      if (team.roster_team_id == null) continue;
      if (team.organization_code) codeByTeamId.set(team.roster_team_id, team.organization_code);
      if (team.team_name) nameByTeamId.set(team.roster_team_id, team.team_name);
      teamIds.add(team.roster_team_id);
    }
  }

  const matchesById = new Map<string, AesFetchedMatch>();
  for (const teamId of teamIds) {
    const rawMatches = await fetchSportwrenchTeamMatches(eventId, teamId);
    for (const m of rawMatches) {
      if (matchesById.has(m.match_id)) continue;

      const sets = extractSets(m.results);
      if (sets.length === 0) continue;

      const ownCode = codeByTeamId.get(teamId) ?? null;
      const ownName = nameByTeamId.get(teamId) ?? "";
      const opponentCode = m.opponent_organization_code ?? null;
      const opponentName = m.opponent_team_name ?? "";
      const isTeam1 = m.match_type === "team1";

      const teamACode = isTeam1 ? ownCode : opponentCode;
      const teamAName = isTeam1 ? ownName : opponentName;
      const teamBCode = isTeam1 ? opponentCode : ownCode;
      const teamBName = isTeam1 ? opponentName : ownName;
      const winnerCode = m.results.winner === "1" ? teamACode : teamBCode;

      matchesById.set(m.match_id, {
        externalMatchId: m.match_id,
        divisionAesId: m.division_id ?? 0,
        divisionLabel: m.division_short_name ?? m.pb_name ?? "",
        teamACode,
        teamAName,
        teamBCode,
        teamBName,
        winnerCode,
        sets,
        setsA: sets.filter((s) => s.a > s.b).length,
        setsB: sets.filter((s) => s.b > s.a).length,
        matchDate: m.date_start ? new Date(m.date_start) : null,
        stage: m.pb_name ?? m.round_name ?? null,
      });
    }
  }

  return { matches: [...matchesById.values()], eventName: eventInfo.name };
}
