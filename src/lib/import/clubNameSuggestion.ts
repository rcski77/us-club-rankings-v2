// Matches an age-group token like "14", "G14", "U14", "B14" -- word-bounded so it
// doesn't false-positive inside an unrelated number ("915") or a token that's really
// something else glued to a number ("14N"). See suggestClubName below.
const AGE_TOKEN_PATTERN = /\b[a-zA-Z]?1[0-8]\b/;

/**
 * Best-effort guess at a club's display name from a parsed AES team name, by
 * truncating at the first age-group token (e.g. "Paramount VBC 14 Jaz" ->
 * "Paramount VBC"). This is NOT reliable for every name shape -- AES team names
 * don't follow one consistent pattern -- so it's meant purely as an editable
 * starting point for the preview grid's "new club name" field, never applied
 * without admin review/save. Falls back to the full name when no age token is
 * found (under-trimming is the safe failure mode; over-trimming/garbling is not).
 */
export function suggestClubName(teamNameClean: string): string {
  const trimmed = teamNameClean.trim();
  const match = trimmed.match(AGE_TOKEN_PATTERN);
  if (!match || match.index === undefined) return trimmed;

  const candidate = trimmed.slice(0, match.index).trim();
  return candidate || trimmed;
}
