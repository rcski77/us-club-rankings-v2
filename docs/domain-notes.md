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

## AES data format (confirmed from a real sample)

The current CSV pipeline (a scraper the user maintains, output reviewed directly) gives
one file per event covering *all* age groups/divisions at once — not one file per
division, which the original legacy system assumed. Columns:

```
ageGroupLabel, rank, "Team Name (RegionCode) (seedNumber)", teamCode
```

Example row: `"12 & Under",3,"HPSTL 12 Royal (GW) (4)",g12hpstl1gw`

- `ageGroupLabel` is free text ("12 & Under") — maps to an integer ageGroup (12).
- `rank` may repeat across rows for ties.
- The team name field embeds two parentheticals: the **region code** (not a club code
  — this was an early wrong assumption, corrected once real data was seen) and a
  **unique tiebreak/seed number** (sequential, no ties — useful for stable ordering
  only, no scoring implication).
- `teamCode` is the reliable structured identifier: fixed-width
  `{gender:1}{ageGroup:2}{clubExternalCode:5}{teamNumber:1}{regionCode:2}`. Example:
  `g14skyln1nt` = girls, 14u, club code "skyln", team #1, region "nt". Decoding this
  gives exact club/team identity with zero fuzzy string matching — this is why
  `Club.externalCode` + `Region` and `TeamSeason.externalTeamCode` exist as they do.
- **Club codes are not globally unique on their own** — only `(externalCode, regionId)`
  together is. Confirmed example: "skyln" is used both by a Dallas-area club under
  region NT and a Jacksonville-area club under region FL.
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

Note AES's embedded 2-letter region codes in team codes (e.g. "nt", "az", "sc") don't
necessarily match USAV's official codes 1:1 in every case (e.g. USAV's Southern
California/Nevada region code is "SCSN," but AES data has been observed using plain
"SC" for at least some Southern California clubs) — this hasn't been fully reconciled
and will matter once Phase 2's AES adapter is built for real.

## Team identity across seasons

A team's roster ages up every year, so the same squad's AES code changes its age digit
season to season (e.g. `g14frogs1nt` this year, `g15frogs1nt` next). `Team` is
therefore a season-independent identity (name + club); `TeamSeason` holds what varies
per season (age group, squad number, that season's code). `Team.lineageKey` exists to
help the *Teams admin UI* suggest "this is probably the same program as last year" —
it is not currently used for anything else, but the original design intended it to
power cross-season rating carry-forward (Phase 4/5's Elo/Massey work) before the
Team/TeamSeason split made that need for a fuzzy heuristic mostly moot.
