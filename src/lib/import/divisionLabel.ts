import { DivisionTierLabel, DivisionGender } from "@/generated/prisma/enums";

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
  genderFromLabel: DivisionGender | null; // from an optional leading "B"/"G" prefix
  // -- null when the label carries no such prefix (the norm for this platform's
  // girls-only history; a row's authoritative gender comes from its team code, see
  // resolve.ts -- this is only a cross-check signal).
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
  // AAU tiers with no dedicated enum value of their own -- folded onto the nearest
  // USAV-equivalent enum value per explicit user direction, see the tier-hierarchy
  // table in docs/domain-notes.md.
  ELITE: "USA",
  SELECT: "CLUB",
  ASCEND: "CLUB",
  ASPIRE: "FREEDOM",
  SPIRIT: "FREEDOM",
};

const TIER_KEYWORDS = Object.keys(TIER_KEYWORD_MAP);

const TIER_LEVEL_PATTERN = /\b(I{1,3})\b/i;

// A Sportwrench event with both boys and girls divisions prefixes each label with a
// bare gender letter right before the age number (e.g. "B18 Open", "G18 Open") --
// confirmed against a real coed event. AES's girls-only events never carry this
// prefix. Stripped before age parsing so it doesn't defeat the leading-digit match.
const GENDER_PREFIX_PATTERN = /^([bg])(?=\d)/i;
const GENDER_PREFIX_MAP: Record<string, DivisionGender> = { b: "BOYS", g: "GIRLS" };

export function parseAgeGroupLabel(label: string): ParsedDivisionLabel | DivisionLabelParseError {
  const trimmed = label.trim();

  const genderPrefixMatch = trimmed.match(GENDER_PREFIX_PATTERN);
  const genderFromLabel = genderPrefixMatch ? GENDER_PREFIX_MAP[genderPrefixMatch[1].toLowerCase()] : null;
  const afterGenderPrefix = genderPrefixMatch ? trimmed.slice(genderPrefixMatch[0].length) : trimmed;

  // Combined-range labels ("12/13 Club") carry two leading numbers, not one -- the
  // nominal ageGroup is the older/max of the two (see file header comment).
  const ageMatch = afterGenderPrefix.match(/^(\d{1,2})(?:\s*\/\s*(\d{1,2}))?/);
  if (!ageMatch) {
    return { raw: label, reason: `No leading age number found in "${label}".` };
  }
  const ageGroup = ageMatch[2] ? Math.max(Number(ageMatch[1]), Number(ageMatch[2])) : Number(ageMatch[1]);
  const remainder = afterGenderPrefix.slice(ageMatch[0].length);

  const keywordMatch = TIER_KEYWORDS.find((keyword) =>
    new RegExp(`\\b${keyword}\\b`, "i").test(remainder),
  );

  const levelMatch = remainder.match(TIER_LEVEL_PATTERN);

  return {
    ageGroup,
    genderFromLabel,
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
