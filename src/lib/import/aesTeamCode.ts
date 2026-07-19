// AES team codes: {gender:1}{ageGroup:2}{clubExternalCode:5}{teamNumber:1+}{regionCode:2}
// e.g. "g14skyln1nt" = girls, 14u, club code "skyln", team #1, region "nt".
// teamNumber is NOT fixed-width and NOT always numeric -- confirmed against a real
// 2026 USAV Girls Junior National Championship sample: team numbers up to at least
// 23 (e.g. "g14afive23so", widening the overall code beyond the naive 11-char
// assumption), and at least one team using a lettered designator instead of a digit
// (e.g. "g14nwrvbace" -- team "a"). Treated as an opaque alphanumeric string, not
// parsed as an integer. Only gender/ageGroup/clubExternalCode (front) and regionCode
// (back) are fixed; teamNumber is everything in between and must be non-empty
// alphanumeric. See docs/domain-notes.md "AES data format" for how this was confirmed.

export type DecodedAesTeamCode = {
  gender: string; // raw char, not restricted to a fixed set -- an unexpected value
  // should flow through to resolve's WARNING machinery rather than being rejected here.
  ageGroup: number;
  clubExternalCode: string; // lowercased, 5 chars
  teamNumber: string; // lowercased, alphanumeric, 1+ chars
  regionCode: string; // lowercased, 2 chars
};

export type AesTeamCodeParseError = { raw: string; reason: string };

export function decodeAesTeamCode(raw: string): DecodedAesTeamCode | AesTeamCodeParseError {
  const code = raw.trim();
  if (code.length < 11) {
    return { raw, reason: `Expected at least 11 characters, got ${code.length}.` };
  }

  const gender = code.slice(0, 1);
  const ageGroupSegment = code.slice(1, 3);
  const clubExternalCode = code.slice(3, 8);
  const teamNumberSegment = code.slice(8, code.length - 2);
  const regionCode = code.slice(code.length - 2);

  if (!/^\d{2}$/.test(ageGroupSegment)) {
    return { raw, reason: `Age group segment "${ageGroupSegment}" is not two digits.` };
  }
  if (!/^[a-zA-Z0-9]+$/.test(teamNumberSegment)) {
    return { raw, reason: `Team number segment "${teamNumberSegment}" is not alphanumeric.` };
  }

  return {
    gender,
    ageGroup: Number(ageGroupSegment),
    clubExternalCode: clubExternalCode.toLowerCase(),
    teamNumber: teamNumberSegment.toLowerCase(),
    regionCode: regionCode.toLowerCase(),
  };
}

export function isAesTeamCodeParseError(
  result: DecodedAesTeamCode | AesTeamCodeParseError,
): result is AesTeamCodeParseError {
  return "reason" in result;
}
