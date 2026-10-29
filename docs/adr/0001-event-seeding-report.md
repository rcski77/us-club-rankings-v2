# ADR 0001: Event seeding report module

- **Status:** Proposed (2026-10-28) — deferred, nothing implemented.
- **Deciders:** project owner

## Context

Tournament directors seed teams into pools/brackets within each division. We already
compute Colley, Elo and Massey power ratings, NPS season points, and store every
imported match, but none of that is available as a seeding aid for an *upcoming* event.
Staff want to upload a CSV of divisions and team codes and get back a report that helps
order teams and group them into pools/bands.

Large divisions (e.g. 76 teams) rule out any full pairwise grid; the report has to
surface only the places where a seeding decision is actually uncertain.

## Decision

Build a **stateless, read-only seeding report**: upload CSV → match team codes → compute
→ render and export. Nothing is written to the database in v1.

### Input
CSV with one row per team entry: **division name** and **team code** (AES code, e.g.
`g14skyln1nt`) required; team/club name optional (shown for unmatched rows). Headers
case-insensitive, unknown columns ignored. Parser is pure and tested
(`src/lib/seeding/parseSeedingCsv.ts`), reusing `src/lib/import/aesCsv.ts` helpers where
they fit. Validation problems are returned, not thrown.

### Team matching
Match by `TeamSeason.externalTeamCode` for the current season, falling back to decoded
lineage (`aesTeamCode.ts`, `lineageKey.ts`) so a team with no code registered yet still
finds last season's history (a club's team code is the team year to year — see
`docs/domain-notes.md`). Rows end up matched, matched-via-lineage, or unmatched.
Unmatched rows stay in the report flagged and are never created in the DB. A code
appearing in two divisions is flagged, not deduped.

### Per-team data
- Identity: team, club, region, age/gender, match status.
- Power ratings: Colley/Elo/Massey rank + rating and average rank (via
  `latestRatings.ts` / `powerRankings.ts`).
- Points: NPS rank and best-3 season total.
- Confidence: matches played, distinct opponents, last match date; prior-season rating
  (labelled) when current-season data is thin.
- Pairwise dominance: rank, ahead/behind/undetermined, how many decided directly.
- Form: quality wins / bad losses vs. the division field, record vs. top half.
- Flags: unmatched, no rating, thin data, engine disagreement, near-tie, seed conflict,
  duplicate code.

Suggested seed is a user-selectable sort (default: average of the three power ranks);
pairwise is shown beside it, never blended in silently.

### Pairwise dominance (new, per field only)
Computed on demand over **one division's field** — explicitly *not* a nightly or
whole-dataset compute (evidence is only meaningful relative to a defined field, and a
global graph over ~19k teams is mostly "undetermined").

For each pair, in order: (1) direct matches this season (match wins, then capped point
margin); (2) common opponents, one hop only, needing ≥ 2 shared opponents and an average
edge ≥ 1 point/set, with per-set margin capped at ±10; (3) otherwise *undetermined* —
not a tie. Score = ahead − behind, competition-ranked. Common opponents may be outside
the division. Evidence window: this season's matches before the event start (works as a
pre-event input and can be backtested on past events). Pure code in
`src/lib/rating/pairwise.ts`; match loader in `src/lib/seeding/loadFieldMatches.ts`.

### Report layout
Routes `/admin/seeding` (upload) → result page, under Events in the sidebar. Per
division: header (field size, rating spread, unmatched count); ranked seeding table with
a conflicts count and flag filters; clusters of near-tied teams with common-opponent
detail cards only inside a cluster; band-boundary cards when a pool count is entered;
team drill-down against ~5 nearest seeds. Cross-division panel for misplaced teams and
duplicate codes. Print view = table, flags, clusters, boundary cards. Reuse `lib/ui.ts`
classes, one `<table>` per division, `prefetch={false}` row links, light theme only.

### Export
CSV of the seeding table (division, suggested seed, team code, ranks/ratings, flags),
modeled on `exportTeamRankings.ts`. No PDF; browser print covers it.

## Alternatives considered

- **Another least-squares/Bradley–Terry rating.** Rejected: Colley/Massey/Elo already
  cover that math implicitly; a fourth would mostly duplicate them.
- **PageRank/Keener-style ranking.** Viable, but harder to explain to directors and more
  sensitive to thin schedules. Pairwise dominance is explainable and yields the pair
  matrix the report needs anyway.
- **Global nightly pairwise.** Rejected: sparse, expensive, and meaningless outside a field.
- **Full pairwise grid per division.** Rejected: ~2,850 pairs for 76 teams; restricted to
  clusters, boundaries and drill-down instead.
- **Persisting reports in v1.** Deferred to avoid schema churn before the format is proven.

## Consequences

- Reports are always fresh against nightly-updated ratings, but can't be revisited later
  unless persistence is added.
- Early in a season many pairs are undetermined; the UI must show sample sizes and the
  undetermined count rather than imply precision.
- Adds one new rating-style module that must be validated (backtest below) before staff
  trust it.

## Open questions

1. What columns does the real upload CSV have? (blocks the parser)
2. Is `externalTeamCode` populated for upcoming-season teams, or do we lean on lineage?
3. Pool/band count: entered in the UI per division, or in the CSV?
4. Default seed sort: average power rank or NPS points?
5. Which already-imported event do we backtest against?

## Implementation phases

1. Pairwise lib + tests, plus an optional read-only panel on the existing division page
   to sanity-check on real events.
2. CSV parse + team matching + match loader.
3. Report page v1: seeding table, flags, division header, cross-division panel.
4. Clusters, boundary check, drill-down cards, print view.
5. CSV export.
6. Optional: persisted/shareable reports; snake-draft pool suggestions with same-club
   separation.

Validation: Vitest for every pure module. Backtest pairwise on a past event (matches
before start date) and report agreement with actual finish order and with average power
rank before trusting it.
