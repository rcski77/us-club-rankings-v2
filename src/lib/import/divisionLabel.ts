import { DivisionTierLabel } from "@/generated/prisma/enums";

// AES's ageGroupLabel column usually carries both the age group and the division
// tier (e.g. "14 American", "14 Open"). The exception is anchor events (Triple
// Crown NIT / USAV Nationals), which have no sub-tiers and show just the bare age
// (e.g. "12 & Under") -- see docs/domain-notes.md. When no tier keyword is found we
// default to OPEN and flag it so an admin can verify.

export type ParsedDivisionLabel = {
  ageGroup: number;
  tierLabel: DivisionTierLabel;
  tierLevel: string | null;
  tierWasDefaulted: boolean;
};

export type DivisionLabelParseError = { raw: string; reason: string };

const TIER_KEYWORDS: DivisionTierLabel[] = [
  "OPEN",
  "NATIONAL",
  "AMERICAN",
  "PATRIOT",
  "LIBERTY",
  "USA",
  "FREEDOM",
];

const TIER_LEVEL_PATTERN = /\b(I{1,3})\b/i;

export function parseAgeGroupLabel(label: string): ParsedDivisionLabel | DivisionLabelParseError {
  const trimmed = label.trim();
  const ageMatch = trimmed.match(/^(\d{1,2})/);
  if (!ageMatch) {
    return { raw: label, reason: `No leading age number found in "${label}".` };
  }
  const ageGroup = Number(ageMatch[1]);
  const remainder = trimmed.slice(ageMatch[0].length);

  const tierMatch = TIER_KEYWORDS.find((tier) =>
    new RegExp(`\\b${tier}\\b`, "i").test(remainder),
  );

  const levelMatch = remainder.match(TIER_LEVEL_PATTERN);

  return {
    ageGroup,
    tierLabel: tierMatch ?? "OPEN",
    tierLevel: levelMatch ? levelMatch[1].toUpperCase() : null,
    tierWasDefaulted: !tierMatch,
  };
}

export function isDivisionLabelParseError(
  result: ParsedDivisionLabel | DivisionLabelParseError,
): result is DivisionLabelParseError {
  return "reason" in result;
}
