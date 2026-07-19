// AES's team name column embeds two trailing parentheticals: the region code
// (redundant cross-check against the team code's region digits) and a sequential
// seed/tiebreak number (display-only, no scoring meaning).
// e.g. `"HPSTL 12 Royal (GW) (4)"` -> cleanName "HPSTL 12 Royal", region "GW", seed 4.

export type ParsedTeamNameField = {
  cleanName: string;
  regionCodeFromName: string | null;
  tiebreakOrder: number | null;
};

const TRAILING_PARENS_PATTERN = /^(.*?)\s*\(([^()]*)\)\s*\(([^()]*)\)\s*$/;

// Never errors -- this field is a cross-check/display source, not load-bearing for
// resolution, so an unrecognized shape just falls back to the raw trimmed name.
export function parseAesTeamNameField(raw: string): ParsedTeamNameField {
  const trimmed = raw.trim();
  const match = trimmed.match(TRAILING_PARENS_PATTERN);
  if (!match) {
    return { cleanName: trimmed, regionCodeFromName: null, tiebreakOrder: null };
  }

  const [, cleanName, regionCode, seed] = match;
  const tiebreakOrder = /^\d+$/.test(seed.trim()) ? Number(seed.trim()) : null;

  return {
    cleanName: cleanName.trim(),
    regionCodeFromName: regionCode.trim() || null,
    tiebreakOrder,
  };
}
