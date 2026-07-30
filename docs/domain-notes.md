# Domain Notes

Background knowledge about the ranking methodology and real-world data formats this
app is built around. Most of this came from direct user interviews and one real AES
sample export — treat it as ground truth for what's implemented, not as speculation.

## What this app ranks

US Club Rankings ranks youth volleyball clubs based on their teams' finishes at
tournaments. The core unit is a **team** (a specific club's squad in a specific age
group, e.g. "MadFrog 14 Green"), not a club — clubs field multiple teams across age
groups and sometimes multiple squads within one age group (legacy naming convention:
"17-1", "17-2" for a club's first and second squad at 17u).

## The point system

- Each **Division** (an age-group + tier bracket within an **Event**, e.g. "14 Open" at
  the "2026 Triple Crown NIT") gets a **point curve** — a table of rank-range → points
  bands (e.g. rank 1 → 245 pts, rank 2 → 230, ranks 3-4 → 220, ... rank 26+ → 180).
- The curve's overall scale (max value, e.g. 245 vs. 190 vs. 145) represents how
  competitive/prestigious that event's division was — set by staff judgment today,
  intended to become an algorithmic suggestion in Phase 3 (see `docs/plan.md`).
- **Anchor events** (`Event.isAnchor`) — USAV Girls Junior National Championships and
  Triple Crown NIT — are the highest tier, always assigned the max curve regardless of
  computed strength-of-field. They're the reference points staff use to build a
  preliminary sense of who's good, which then informs how every other event gets
  judged. In the future rating engine, anchor events seed the rating system rather
  than being judged by it.
- A team's **season ranking** = sum of its best 3 point-finishes across the season
  (worst finishes beyond the top 3 are discarded). Ties in total points share a rank
  (competition-ranking style: 1, 2, 2, 4 — not 1, 2, 2, 3).
- **`ignoreAge`**: a team can play in a division whose age group differs from their
  own (playing up, usually) and still have that finish count toward their *natural* age
  group's ranking, if the finish is flagged `ignoreAge`. Implemented in
  `computeRanking.ts` by resolving the team's age group for that season via
  `TeamSeason`, not the division's age group. (This semantic is an assumption, not
  confirmed against legacy v1 behavior — see `docs/plan.md` Open Question 2.)
- **Point band tail convention**: `toRank = 0` means "and beyond" (open-ended), e.g. a
  band `fromRank: 26, toRank: 0, points: 180` covers rank 26 through however many teams
  finished. This matches the legacy admin UI's convention.

## Division tier hierarchy (`DivisionTierLabel`)

`DivisionTierLabel` is one shared enum/dropdown across both USAV and AAU events (see
the AAU merge note on the enum itself in `prisma/schema.prisma`), so the tier picker
throughout the admin UI (`events/[eventId]/page.tsx`,
`events/[eventId]/divisions/[divisionId]/page.tsx`) lists values **best-to-worst
division strength**, merging both governing bodies' hierarchies into one order (per
user direction, 2026-07-30):

```
OPEN > PREMIER > USA > LIBERTY > AMERICAN > CLUB > FREEDOM > CLASSIC > PATRIOT
```

USAV's own best-to-worst order is Open > National (→ `PREMIER`, see the enum's own
merge note) > USA > Liberty > American > Freedom > Patriot — Open requires an earned
bid at a national qualifier, Patriot is the only national division not requiring a
pre-earned bid. AAU's tiers don't map one-to-one onto USAV's (AAU has its own
Elite/Select-Ascend/Aspire-Spirit tiers with no dedicated enum value), so they're
folded onto the nearest USAV-equivalent enum value (per explicit user direction,
2026-07-30):

| AAU tier       | Maps to enum |
|----------------|--------------|
| Open           | `OPEN`       |
| Premier        | `PREMIER`    |
| Elite          | `USA`        |
| Select/Ascend  | `CLUB`       |
| Club           | `CLUB`       |
| Aspire/Spirit  | `FREEDOM`    |
| Classic        | `CLASSIC`    |

This is a merged-ordering judgment call, not a confirmed cross-body equivalence
table — revisit if AAU/USAV cross-comparison ever needs to be precise rather than
just "reasonable dropdown order."

## AES data format (confirmed from a real sample)

The current CSV pipeline (a scraper the user maintains, output reviewed directly) gives
one file per event covering *all* age groups/divisions at once — not one file per
division, which the original legacy system assumed. Columns:

```
ageGroupLabel, rank, "Team Name (RegionCode) (seedNumber)", teamCode
```

Example row (from a real 2026 USAV Girls Junior National Championship 14-17 sample,
352 rows across 6 tiers): `14 American,1,Paramount VBC 14 Jaz (CH) (1),g14parvb1ch`.
**No header row and no field quoting** in real exports — the `csv-parse`-based parser
(`src/lib/import/aesCsv.ts`) tries header-based parsing first (for a hypothetical
future export that does have one) and falls back to strict positional 4-column
parsing, which is what real files hit today.

- `ageGroupLabel` carries both the age group *and* the division tier (e.g. "14
  American", "14 Open", "14 Freedom") — parsed into an integer `ageGroup` (leading
  number) + `tierLabel` (case-insensitive keyword match against `DivisionTierLabel`) +
  optional `tierLevel` (roman numeral). Every row of the real 352-row Nationals sample
  carried a tier keyword, including from anchor events — so the "bare age, no tier"
  case (e.g. "12 & Under", seen in an earlier, smaller Triple Crown NIT sample) is
  evidently not universal even across anchor events, and may be specific to Triple
  Crown NIT in particular. The Phase 2 import pipeline still defaults `tierLabel` to
  `OPEN` and flags the row (`tierWasDefaulted`) for admin review when no tier keyword
  is found, rather than guessing silently, but this fallback is not expected to trigger
  often in practice — see `docs/plan.md` §2 (Phase 2) for the full parsing/resolve
  design (`src/lib/import/divisionLabel.ts`).
- `rank` may repeat across rows for ties.
- The team name field embeds two parentheticals: the **region code** (not a club code
  — this was an early wrong assumption, corrected once real data was seen) and a
  **unique tiebreak/seed number** (sequential, no ties — useful for stable ordering
  only, no scoring implication).
- `teamCode` is the reliable structured identifier:
  `{gender:1}{ageGroup:2}{clubExternalCode:5}{teamNumber:1+}{regionCode:2}`. Example:
  `g14skyln1nt` = girls, 14u, club code "skyln", team #1, region "nt". **`teamNumber`
  is not fixed-width, and not always numeric** — confirmed from the real Nationals
  sample: team numbers up to 23 (`g14afive23so`, the multi-region "A5" club chain
  fielding 10+ teams under one shared code, widening the whole code past the
  originally-assumed 11 characters), and at least one team using a lettered
  designator instead of a digit (`g14nwrvbace` — team "a", confirmed as real/valid
  AES behavior, not a data error). `TeamSeason.teamNumber` and
  `ImportRow.parsedTeamNumber` are `String`, not `Int`, for exactly this reason.
  `src/lib/import/aesTeamCode.ts` decodes by taking the fixed 8-char prefix
  (gender+ageGroup+clubExternalCode) and fixed 2-char region suffix, treating
  everything in between as the team designator and requiring it to be non-empty
  alphanumeric (a code where that middle segment contains anything else, e.g.
  punctuation, is flagged as a decode error rather than guessed). Decoding gives
  exact club/team identity with zero fuzzy string matching — this is why
  `Club.externalCode` + `Region` and `TeamSeason.externalTeamCode` exist as they do.
- **Club codes are not globally unique on their own** — only `(externalCode, regionId)`
  together is. Confirmed both from an early hypothetical example ("skyln" used by a
  Dallas-area club under region NT and a Jacksonville-area club under region FL) and
  independently from the real Nationals sample, which has exactly that: a Dallas-area
  "Skyline" program fielding 5 teams under code "skyln"/region NT, and a separate "JAX
  SKYLINE" under code "skyln"/region FL.
- **Large events get split across multiple files** ("_part1", "_part2", ...) because
  the source scraper errors past ~300 lines. The import pipeline (Phase 2, not built
  yet) needs to treat a multi-part upload as one logical dataset.

## Match-level AES data

Individual match/set results (not just final placement) are reachable via AES's
public, unauthenticated results API — confirmed by two independently-working sibling
repos in this workspace: `aes-tourney-director/services/matchSync.ts` (fetches
per-match/per-set data from
`results.advancedeventsystems.com/api/event/{eventId}/courts/match/{matchId}`) and
`AES Scraping/Match Results/aes_match_results.py` (already emits a `match_results.csv`
with real set scores). This is what unblocks the Phase 5 Elo/Massey rating engine
without needing new scraper work — see `docs/plan.md` §2 and Open Question 11.

## USAV regions

40 official USAV regions across 4 zones (source: usavregions.org, seeded via
`npm run db:seed-regions`):

- **Atlantic Zone**: Carolina, Chesapeake, Excelsior Empire, Florida, Garden Empire,
  Keystone, New England, Old Dominion, Palmetto, Southern, Western Empire
- **Border Zone**: Arizona, Bayou, Delta, Gulf Coast, Lonestar, North Texas, Oklahoma,
  Sun Country
- **Central Zone**: Badger, Gateway, Great Lakes, Great Plains, Heart of America,
  Hoosier, Iowa, Lakeshore, North Country, Ohio Valley, Pioneer
- **Pacific Zone**: Alaska, Aloha, Columbia Empire, Evergreen, Intermountain, Moku O
  Keawe, Northern California, Puget Sound, Rocky Mountain, Southern California /
  Southern Nevada

Note AES's embedded 2-letter region codes in team codes (e.g. "nt", "az", "sc") are
always exactly 2 characters — so `Region.code` is seeded to match that 2-char
convention throughout (see the comment on `Region.code` in `schema.prisma`).
Southern California / Southern Nevada is seeded as `"SC"`, not USAV's own "SCSN"
abbreviation, specifically because every real AES sample for that region uses "sc" —
seeding the 4-letter form would make it permanently unmatchable against import data.
Any other region-code mismatch (typos, genuinely unknown codes) is still surfaced as a
`WARNING`-status row an admin can override past, never a hard blocker or a silent
guess.

## Team identity across seasons

A team's roster ages up every year, so the same squad's AES code changes its age digit
season to season (e.g. `g14frogs1nt` this year, `g15frogs1nt` next). `Team` is
therefore a season-independent identity (name + club); `TeamSeason` holds what varies
per season (age group, squad number, that season's code). `Team.lineageKey` exists to
help the *Teams admin UI* suggest "this is probably the same program as last year" —
it is not currently used for anything else, but the original design intended it to
power cross-season rating carry-forward (Phase 4/5's Elo/Massey work) before the
Team/TeamSeason split made that need for a fuzzy heuristic mostly moot.
