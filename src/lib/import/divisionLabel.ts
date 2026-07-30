import { DivisionTierLabel } from "@/generated/prisma/enums";

// AES's ageGroupLabel column usually carries both the age group and the division
// tier (e.g. "14 American", "14 Open"). The exception is anchor events (Triple
// Crown NIT / USAV Nationals), which have no sub-tiers and show just the bare age
// (e.g. "12 & Under") -- see docs/domain-notes.md. When no tier keyword is found we
// default to OPEN and flag it so an admin can verify.
//
// Some events also genuinely combine two age groups into one division ("12/13 Elite",
// a real bracket where 12u and 13u teams compete together, not a mislabeled pair of
// single-age divisions -- confirmed against real Triple Crown Colorado Challenge data).
// The division's nominal ageGroup for a combined label is the OLDER of the two ages --
// the convention this app already uses elsewhere (ignoreAge) is that a combined
// bracket is "for" the older age, and a younger team competing in it is the one
// playing up.
//
// NOTE: the confirmed "12/13 Club" example above predates AAU's CLUB tier keyword
// (see TIER_KEYWORDS below). A label like "12/13 Club" now parses as tierLabel=CLUB
// rather than defaulting to OPEN -- if a genuinely untagged USAV combined bracket
// happens to use the word "Club", it will be misread as an AAU Club-tier division.
// Revisit if that turns out to still occur in real USAV data.

export type ParsedDivisionLabel = {
  ageGroup: number;
  tierLabel: DivisionTierLabel;
  tierLevel: string | null;
  tierWasDefaulted: boolean;
};

export type DivisionLabelParseError = { raw: string; reason: string };

// Keyword -> tier, not just a list of tiers, because "National" (USAV) and
// "Premier" (AAU) are treated as the same real-world tier and both map to the
// single PREMIER enum value -- see the DivisionTierLabel comment in schema.prisma.
const TIER_KEYWORD_MAP: Record<string, DivisionTierLabel> = {
  OPEN: "OPEN",
  AMERICAN: "AMERICAN",
  PATRIOT: "PATRIOT",
  LIBERTY: "LIBERTY",
  USA: "USA",
  FREEDOM: "FREEDOM",
  NATIONAL: "PREMIER",
  // AAU tiers. Note "CLUB" collides with the combined-age-range "Club" example
  // in the file header comment (e.g. "12/13 Club") -- a label like that now parses
  // as tierLabel=CLUB instead of defaulting to OPEN. Confirm against real AAU vs.
  // USAV data if that combined-range case resurfaces.
  PREMIER: "PREMIER",
  CLUB: "CLUB",
  CLASSIC: "CLASSIC",
};

const TIER_KEYWORDS = Object.keys(TIER_KEYWORD_MAP);

const TIER_LEVEL_PATTERN = /\b(I{1,3})\b/i;

export function parseAgeGroupLabel(label: string): ParsedDivisionLabel | DivisionLabelParseError {
  const trimmed = label.trim();
  // Combined-range labels ("12/13 Club") carry two leading numbers, not one -- the
  // nominal ageGroup is the older/max of the two (see file header comment).
  const ageMatch = trimmed.match(/^(\d{1,2})(?:\s*\/\s*(\d{1,2}))?/);
  if (!ageMatch) {
    return { raw: label, reason: `No leading age number found in "${label}".` };
  }
  const ageGroup = ageMatch[2] ? Math.max(Number(ageMatch[1]), Number(ageMatch[2])) : Number(ageMatch[1]);
  const remainder = trimmed.slice(ageMatch[0].length);

  const keywordMatch = TIER_KEYWORDS.find((keyword) =>
    new RegExp(`\\b${keyword}\\b`, "i").test(remainder),
  );

  const levelMatch = remainder.match(TIER_LEVEL_PATTERN);

  return {
    ageGroup,
    tierLabel: keywordMatch ? TIER_KEYWORD_MAP[keywordMatch] : "OPEN",
    tierLevel: levelMatch ? levelMatch[1].toUpperCase() : null,
    tierWasDefaulted: !keywordMatch,
  };
}

export function isDivisionLabelParseError(
  result: ParsedDivisionLabel | DivisionLabelParseError,
): result is DivisionLabelParseError {
  return "reason" in result;
}
