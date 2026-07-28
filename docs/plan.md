# Implementation Plan & Roadmap

This is the living version of the plan approved at the start of this project. It's
kept in-repo (rather than only in a Claude Code plan-mode file outside the project)
specifically so a new session — on this machine or another — can pick up the project
without re-deriving context. Update the **Status** section as phases land; keep the
**Deviations** section current when reality diverges from the original design (it
already has).

See also: [`docs/domain-notes.md`](./domain-notes.md) for ranking/USAV domain
knowledge, [`docs/dev-environment.md`](./dev-environment.md) for local dev setup and
known gotchas, [`prisma/CLAUDE.md`](../prisma/CLAUDE.md) for schema conventions, and
[`src/app/admin/CLAUDE.md`](../src/app/admin/CLAUDE.md) for admin UI conventions.

## Context

US Club Rankings ranks youth volleyball clubs from team finishes at tournaments. The
legacy (v1) backend is old, undocumented, and entirely manual: staff export CSVs from
four tournament platforms (AES, Sportwrench, TM2, VBSchedule), hand-import
events/divisions/team-finishes, and then — the most time-consuming step — manually
decide how many points each division at each event is worth, by eyeballing which
currently-strong teams showed up. That subjective point-assignment process is the main
bottleneck this rebuild targets.

Two things beyond a straight port were requested:

1. **Make point-curve assignment algorithmic.** Staff currently look at how the
   strongest teams finish at USAV Nationals / Triple Crown NIT to build a preliminary
   sense of who's good, then judge every other event's strength against that picture.
   The goal is to automate the "judge strength of field" step — suggest, not dictate;
   staff still confirm.
2. **Add an Elo/Massey-style rating layer** — both to sharpen the point-curve
   suggestion, and to enable a continuously-updating weekly power ranking instead of
   one end-of-season computation.

Scope for this plan: **admin/back-office application only.** The public-facing
rankings website is explicitly out of scope.

Stack: Next.js (App Router) + TypeScript + PostgreSQL + Prisma — user's explicit
preference, non-negotiable.

## Status

| Phase | What | Status |
|---|---|---|
| 0 | Foundations — scaffold, auth, base schema | ✅ Done |
| 1 | Manual parity core — Events/Divisions/PointTemplates/scoring/TeamFinish/Rankings | ✅ Done |
| 1.5 | Team/TeamSeason restructuring, Regions+zones (post-Phase-1 additions) | ✅ Done |
| 2 | CSV import pipeline (AES adapter first) | ✅ Done (AES adapter, TEAM_FINISHES only) |
| 3 | Tier 1 rating engine (Colley) + algorithmic scoring suggestion | ✅ Done (Colley solve; FSS + suggestion + scoring-review screen; Analysis view + histogram; non-anchor template seeding; prior-run FSS-history comparison) |
| 4 | Cross-season bootstrapping and calibration | Not started |
| 5 | Tier 2 upgrade (Elo + Massey from real match data) | In progress (MATCH_RESULTS import ✅; Elo engine ✅; Massey not started) |
| 6 | Polish — flags, ballots, weight config, background jobs, hosting | Not started |

**Where things actually stand right now:** a fully working admin app for hand-operated
season management — create a season, clubs, teams (enrolled per-season via
`TeamSeason`), events, divisions, point templates, apply a curve to a division by hand
or from a template, enter team finishes, confirm scoring, and see the resulting
top-3-of-season ranking per age group, including the `ignoreAge` cross-age-group case.
Verified end-to-end against a real scenario (2026 Triple Crown NIT / 14 Open, scored
against the legacy 245/230/220/180 curve). CSV import (Phase 2) now covers AES
TEAM_FINISHES bulk-import via `/admin/imports`, so team finishes no longer have to be
typed in one row at a time — see §3. No algorithmic scoring yet — point curves are
always picked/applied by a human. `npm run db:seed-demo` rebuilds this walkthrough
data from scratch.

**Phase 3, first slice — Colley rating engine — done.** `src/lib/rating/colley.ts`
(pure: pairwise-comparison builder + hand-rolled Gaussian-elimination Colley solve,
unit-tested) and `src/lib/rating/computeColleyRatings.ts` (Prisma orchestration:
gathers CONFIRMED finishes up to an `asOfDate`, resolves `ignoreAge` finishes to the
team's *natural* age group exactly like `computeRanking.ts`, builds per-division
win/loss comparisons — same-rank ties produce no comparison — solves per
`(season, ageGroup)`, and persists a `TeamRatingHistory` snapshot). New
`TeamRatingHistory` model added to the schema (not yet the full `MasseyRatingRun`/
`MasseyTeamRating` — those stay Phase 5). Triggered manually today (no background-job
infra yet — that's Phase 6) from a new `/admin/power-rankings` page (season selector +
"Recompute ratings" button) and viewed per `(season, ageGroup)` at
`/admin/power-rankings/[seasonId]/[ageGroup]`. Verified against real imported AES data
already in the dev DB (81 rated 14u teams) — ratings ordered sensibly, and the
"isolated team" edge case (a lone `ignoreAge` team with no peer in its natural age
group's graph) correctly produces no rating row rather than a degenerate one.
**Phase 3, second slice — FSS + suggestion mapping + scoring-review screen — done.**
`src/lib/rating/fieldStrength.ts` (pure: FSS = mean rating of the top half by rating
among a division's rated teams; Top5/10/25/.../250 bucket counts by each team's
*national* Colley rank, not division rank; raw scale-factor inputs `teamCount`/
`matchVolume`; confidence warnings `SMALL_FIELD`/`NO_HISTORY`/`LOW_PERCENT_RATED`, all
placeholder-cutoff, unit-tested) plus `computeDivisionFieldStrength.ts` (Prisma
orchestration: latest `TeamRatingHistory` row per team in the division). Layered on
top, `src/lib/rating/suggestPointTemplate.ts` (pure: FSS's percentile within the
*full* (season, ageGroup) rating population — not against other divisions' FSS, which
is what makes it self-calibrating without needing historical snapshot data yet — a
plain-language score band from percentile, and a percentile-to-non-anchor-template
linear mapping, unit-tested) plus `computeDivisionScoringSuggestion.ts` (orchestration:
runs the full pipeline and persists a `DivisionScoringSnapshot`, sets
`Division.scoringStatus` to `SUGGESTED`). New `DivisionScoringSnapshot` model
(audit-trail pattern, not a live view — see `prisma/CLAUDE.md`) with a
`PENDING|ACCEPTED|OVERRIDDEN` status. New screen
`/admin/events/[eventId]/divisions/[divisionId]/scoring`: shows FSS/percentile/band/
bucket counts/warnings/suggested template; **Accept** copies the suggested template's
bands into `DivisionPointBand` (frozen-copy pattern, same as the existing manual
apply-template flow) and confirms scoring in one step; **Override** requires a reason,
marks the snapshot `OVERRIDDEN`, and drops the division back to `DRAFT` for the
existing manual apply-template/confirm flow. Verified end-to-end in the browser
against the real 14 Open division (FSS 0.732 → 77th percentile → "Strong regional" →
correctly picked the strongest available non-anchor template; Override correctly
reverted the division to DRAFT) — demo data restored via `npm run db:seed-demo`
afterward, which is idempotent and doesn't touch `DivisionScoringSnapshot` rows.
**Phase 3, third slice — Colley-rating distribution histogram + Analysis view — done.**
`src/lib/rating/ratingHistogram.ts` (pure: bins a list of ratings into fixed-width
buckets, unit-tested — single-bin fallback for empty/all-equal input, max value
assigned to the last bin rather than overflowing) plus a new
`getDivisionRatedRatings()` export on `computeDivisionFieldStrength.ts` (shares the
existing latest-rating-per-team lookup, factored into `fetchLatestRatedTeams()`, so
FSS and the histogram don't duplicate the Prisma query). Rendered as a dependency-free
server-rendered inline SVG bar chart
(`.../scoring/RatingHistogramChart.tsx`) on the existing scoring-review screen, below
the bucket-participation table. New `/admin/analysis` (season/age-group selector,
mirrors `/admin/power-rankings`'s pattern) → `/admin/analysis/[seasonId]/[ageGroup]`
(one row per Division in that season/age group — event, scoring status, team count,
FSS/percentile/band, all 8 bucket counts, suggested template — pulling each
division's latest `DivisionScoringSnapshot` via a single relation-scoped `include`,
not N+1 queries) — the side-by-side view for sanity-checking one division's suggestion
against every other division's in the same age group. Verified in the browser against
real seed data: the confirmed 14 Open/Triple Crown NIT division shows its full
snapshot (FSS 0.732, 77th percentile, "Strong regional", histogram shaped as expected)
next to five still-DRAFT USAV Nationals divisions with no snapshot yet (shown as "—").
**Phase 3, fourth slice — prior-run FSS-history comparison — done.** The scoring-review
screen (`.../scoring/page.tsx`) now fetches every `DivisionScoringSnapshot` for the
division (not just the latest), and renders a "History" table below the current
suggestion — run date, FSS, percentile, band, suggested template, and snapshot status
for each prior run, most-recent first, with the current row marked — whenever more
than one snapshot exists. No schema change needed (`DivisionScoringSnapshot` rows were
already append-only with `createdAt`); this is purely a read of existing history that
had no UI yet. Verified in the browser against the real "The Nike Classic / 14 Open"
division (already CONFIRMED from an earlier manual run): regenerating a second
suggestion correctly showed both runs in the History table (FSS 0.639→0.678,
"Solid regional"→"Strong regional" as more matches connected into the rating graph)
with the newer one marked current. This completes Phase 3.

**Phase 5, first slice — Match Results import (AES) — done.** New `Match` model
(`prisma/schema.prisma` — eventId/divisionId/teamAId/teamBId/winnerTeamId/matchDate/
stage/setsA/setsB/setScores JSON/externalMatchId, unique on `(eventId,
externalMatchId)` for idempotent re-import; the model plan §1.4 described as "modeled
now" hadn't actually been added to the schema until this slice). `src/lib/import/
aesMatches.ts` fetches every completed match for an AES event: AES has no single
"all matches" endpoint, so this fetches standings first (per-division team list, each
team's AES numeric TeamId + structured TeamCode) then queries every team's
`schedule/past` endpoint and de-dupes by MatchId since a completed match appears in
both participants' schedules — the approach ported from a sibling repo's already-
working scraper (`AES Scraping/Match Results/aes_match_results.py`), not new
reverse-engineering. `src/lib/import/resolveMatches.ts` (pure, unit-tested) resolves
each fetched match's two team codes against the event's already-imported
`TeamSeason` rows and — this is the key design decision — resolves the match's
Division from the team's own existing `TeamFinish.divisionId`, **not** by re-parsing
AES's division-name text a second time: AES's JSON standings API gives a division's
bare name (e.g. "13 Club"), while the CSV export's `ageGroupLabel` column that
TEAM_FINISHES divisions are actually named from can carry a combined-age label for
that same division (e.g. "12/13 Club", see `divisionLabel.ts`) whenever a younger
team played up into it — re-parsing the JSON label the same way TEAM_FINISHES parses
CSV text would silently mismatch on every combined-age division. Going through the
team's real recorded finish instead sidesteps that gap entirely and reuses the same
ground truth the ranking/rating engines already trust. A match with either team
unresolved (no TeamSeason/TeamFinish yet — most commonly a pool-only team that never
received an official numeric rank, so was never part of the TEAM_FINISHES import) is
skipped with a reason, not created as a new record — the review UI shows a sample of
skip reasons. `src/lib/import/commitMatches.ts` runs fetch+resolve+commit as one
action (unlike TEAM_FINISHES's multi-step resolve/preview/override/commit staging —
match rows are deterministic from data that's already trusted, no free-text admin
judgment call to stage a grid for) and is safe to re-run (upserts by
`(eventId, externalMatchId)`), which matters in practice since re-running after a
later, more-complete TEAM_FINISHES import picks up previously-skipped matches. Wired
into `/admin/imports` (new "Type" selector alongside the existing Team Finishes
start-batch flow) and a dedicated view at `/admin/imports/[batchId]` for
`MATCH_RESULTS` batches (no ImportRow grid — a Fetch/Re-fetch button, a
read-only match table, and a skipped-reasons list). Verified end-to-end against the
real 2026 Triple Crown Colorado Challenge event already in the dev DB (727 completed
matches fetched from AES; ~364 resolved and imported, ~363 correctly skipped as
teams with no official TEAM_FINISHES rank) — confirmed the division-via-TeamFinish
fix specifically against that event's real "12/13 Club" combined-age division, which
is exactly the case that would have silently mismatched under label re-parsing.
**Phase 5, second slice — Elo engine — done.** `src/lib/rating/elo.ts` (pure:
standard logistic Elo — `E_A = 1/(1+10^((R_B-R_A)/400))` — applied via
`computeEloRatings()` which sorts a match list chronologically and replays it
sequentially, since Elo is path-dependent, unlike Colley's order-independent batch
solve; margin-of-victory multiplier from the winner's set fraction (`0.8 + 0.4 *
fraction`, so a sweep counts for more than a narrow win); per-team provisional K
(40 vs a base 24) while that team has fewer than 10 season matches so far, tracked
independently per team as the replay progresses; unit-tested including an
order-independence check — replaying the same matches in shuffled input order
produces identical ratings, confirming the explicit sort is what makes replay safe,
not incidental input ordering) plus `computeEloRatings.ts` (Prisma orchestration:
same per-`(season, ageGroup)` partitioning, ignoreAge-via-`TeamSeason` resolution,
and delete-and-replace `TeamRatingHistory` snapshot pattern as `computeColleyRatings.ts`
— see that file's comment for why. Deliberately **no standings-inferred fallback**:
Elo only exists once real `Match` rows do, so a division with finishes but no
imported matches contributes nothing to Elo, unlike Colley which falls back to
rank-inferred comparisons). New `ELO` value on the `RatingEngine` enum (alongside
`COLLEY`, both stored in the same `TeamRatingHistory` table, distinguished by
`ratingEngine`). `/admin/power-rankings` gained a second "Recompute Elo ratings"
button; the ratings-detail page shows Colley and Elo side by side as separate columns
in one merged table (per-engine `weekEndingDate` looked up independently, rows sorted
by Colley rank with any Elo-only team appended after — a division with imported
matches but no Colley-eligible standings yet, though not seen in practice so far), `—`
for a team not yet rated by one of the two engines. Verified
end-to-end in the browser against real imported AES match data (2026 Triple Crown
Colorado Challenge, 14u): 199 teams rated, ratings ordered sensibly (teams with fewer
warmed-up matches sit closer to the 1500 default, as expected from the provisional-K
design), and the Colley and Elo views agree on the top team (Legacy 14-1 ADIDAS)
despite being fully independent computations over different underlying data
(rank-inferred comparisons vs. real match results) — a reassuring cross-check, not a
coincidence the code enforces.
**Phase 5, third slice — per-team Elo match history — done.** `elo.ts` refactored
around a shared internal `replay()` so `computeEloRatings()` (final ratings only) and
the new `computeEloHistory()` (the full per-match trace: both teams' before/after
rating, win expectation, K, margin multiplier for every match, in chronological order)
can never drift apart on the actual Elo math. New `explainEloChange()` (pure) turns
one match's numbers into a plain-language sentence — classifies the team's pre-match
role (favorite/even/underdog from win expectation) and the match's margin
(dominant/moderate/narrow from the multiplier) into a combined sentence, e.g. "A win
you were expected to get, so your rating moved up only a little. The dominant margin
still earned solid credit." `computeEloRatings.ts` gained `getTeamEloHistory(teamId,
seasonId, asOfDate)`: resolves the team's natural age group for that season, replays
the *same* match graph its current rating snapshot came from (factored into a shared
`getPartitionMatches()` used by both this and `computeEloRatingsForPartition()`, so
history and current rating are always consistent with each other), then slices out
just this team's steps and reorients each from "team A/B" into "this team vs.
opponent." Rendered on `/admin/teams/[teamId]` folded into the existing "Match
Results" section rather than as a separate list — the two were showing largely the
same matches twice, so `eloByMatchId` (a `Map` from `getTeamEloHistory()`'s results,
keyed by `matchId`) looks up each match's Elo data by id and augments the same row
instead. Each match is a `<details>/<summary>` — plain HTML, no client-side JS —
whose summary line adds the rating before → after and delta onto the existing
date/event/division/opponent/sets/result columns, expanding to a "Why your Elo
changed" panel (opponent link, stage, opponent's rating, win expectation, K, the
`explainEloChange()` sentence) modeled on a competitor site's own per-match Elo
breakdown; a match outside the current Elo rating graph (no `matchDate`, or not yet
picked up by a "Recompute Elo ratings" run) shows "No Elo data" instead of blank
columns. Verified end-to-end in the browser
against Legacy 14-1 ADIDAS's real 29-match history (2025-2026, 14u): correctly starts
its unbeaten run at the season-default 1500 with the full provisional K (+24 per win
while under 10 matches), gradually settles toward the base K once past game 10, and
correctly shows a sharp -17 drop on its one real loss (to Dal Skyline 14 Royal-Erin at
Triple Crown NIT) with an "upset"-appropriate explanation.
**Phase 5, fourth slice — Elo-based DCI upgrade to the Phase 3 scoring suggestion —
done.** New `src/lib/rating/dci.ts` (pure): a "Division Competitiveness Index," an
Elo-based alternative to the Colley FSS/elitePresence blend, modeled on a competitor
site's published Tournament Competitiveness Index methodology (Elite Presence 40% /
Strength of Field 25% / Scale Factor 35%). `ELO_ELITE_THRESHOLD` (1450) and the two
`SCALE_REFERENCE_*` constants are explicitly uncalibrated placeholders, but checked
against this project's own real division data rather than guessed — e.g. 1450 (not a
population-relative percentile cutoff, which would make even the strongest field in
the country look weak, since Elite Presence is intrinsic to a division's own teams)
puts both Triple Crown NIT and USAV Nationals 14 Open around 80% while a genuinely
weaker regional field sits around 68%, a real gap rather than everything clustering
near 100%. `computeDivisionEloStrength.ts` (Prisma orchestration, the Elo-path analog
of `computeDivisionFieldStrength.ts`) plus new `computeElitePresence()` (in
`fieldStrength.ts`) and `blendPercentileWithElitePresence()` (in
`suggestPointTemplate.ts`) extend the *existing* Colley path with the same Elite
Presence idea, so a large-but-genuinely-elite field (Triple Crown NIT) isn't undersold
by FSS's mean-of-top-half alone, which field depth dilutes.
`computeDivisionScoringSuggestion.ts` now picks the Elo/DCI path over the original
Colley/FSS path once at least `ELO_COVERAGE_THRESHOLD` (50%) of a division's teams
have Elo ratings (imported Match data) — mirrors `computeColleyRatings.ts`'s own
per-division match-vs-standings fallback design, and for the same reason: a handful
of incidentally-rated teams (3 of 64) shouldn't override the far more complete
Colley/standings signal with an unrepresentative sample. Elo has no standings-inferred
fallback of its own (see the Phase 5 second-slice entry above), so a division without
enough Match data always falls back to Colley. New `DivisionScoringSnapshot` fields
`ratingEngineUsed` (`"ELO" | "COLLEY"`, null on snapshots predating this field) and
`elitePresence`. Both `/admin/analysis` and the division scoring-review screen
(including its History table) show the new Engine/Elite % columns, with FSS displayed
at the appropriate scale for whichever engine produced it (Colley's 0-1 float vs.
Elo's ~1500 scale). Verified end-to-end in the browser against real data: Triple Crown
NIT 14 Open (75 teams, 99% Elo-rated) now scores via the ELO/DCI path — FSS 1637,
Elite Presence 77%, 83rd percentile, "Strong regional," suggested "215 max" — and its
History table preserves the division's whole calibration trail, including the
pre-1450-threshold run that had briefly shown only 15% Elite Presence before the
threshold was corrected.
**Not yet built**: Massey engine (Phase 5's remaining scope — see §2/§6), CPI
activation, Power Rankings switching its default/primary labeling from Colley to Elo
(both are shown side-by-side today, selectable, neither demoted yet),
Sportwrench/TM2/VBSchedule match-level fetchers (AES only so far, matching
TEAM_FINISHES's existing source coverage).

**Non-anchor `PointTemplate` library — seeded.** `prisma/seedPointTemplates.ts` (new
`db:seed-point-templates` script, idempotent — upserts by name, replaces bands
wholesale) now seeds 13 real non-anchor tiers spanning 190→100 max points: 8 sourced
directly from real point-curve screenshots from last season (190/185/180/175/170/
165(interpolated)/160/150(interpolated) max), plus 5 lower tiers (140/130/120/110/100
max) filled in by scaling down from the lowest real tier since no screenshot covered
that range — each interpolated template's `description` says so explicitly. Verified
against the live suggestion pipeline: regenerating a suggestion for the (previously
untested, still-DRAFT) 14 American/USAV Nationals division now correctly picks a
template proportional to its percentile (17th → "170 max") instead of the single
option that existed before this tier library existed.

## Deviations from the original plan

The plan below is preserved close to its original approved form for continuity, but
two things changed after Phase 1 shipped, based on direct user feedback:

1. **Team is no longer season-scoped.** The original schema (§1.2 below) had
   `Team.seasonId` as a required field — a team was really "this club's roster entry
   for this season." The user pushed back: a team should belong to multiple seasons,
   filterable, not duplicated per season. Reworked into `Team` (persistent identity:
   name + club) + a new `TeamSeason` join model (`teamId`, `seasonId`, `ageGroup`,
   `teamNumber`, `externalTeamCode` — the fields that actually vary year to year).
   **This matters for later phases**: anywhere §1.2–§2.5 below say "Team.ageGroup" or
   "Team.seasonId," read that as "the team's `TeamSeason` row for the season in
   question." `lineageKey` (used for cross-season rating carry-forward, §2.5) now
   lives on `Team` itself rather than needing season-scoped inference — the identity
   problem `lineageKey` was solving is now solved structurally by `Team` existing
   independent of season.
2. **Region got a `zone` field and its own admin page.** Not in the original plan at
   all — added because seeding real USAV region data (40 regions across Atlantic/
   Border/Central/Pacific zones, from usavregions.org) naturally wanted a `UsavZone`
   enum for display grouping, and the region list/create UI got its own `/admin/regions`
   tab instead of living inside the Clubs page.

Nothing else has diverged. The rating-engine design (§2), import pipeline design (§3),
and ranking computation (§4) below are all still the intended design for their
respective phases — none of that has been built yet, so none of it has been tested
against reality the way the schema was.

---

## 1. Prisma Schema (original design — see Deviations above for what changed)

### 1.1 Reference / org data
- Region — id, name, code (2-char, e.g. "NT", "AZ", "SC" — these are exactly the
  region codes embedded in AES team codes, see 1.2). Referenced by Club. *(Now also
  has a `zone: UsavZone?` field — not in the original design.)*
- Season — id, label ("2025-2026"), startDate, endDate, isActive. All ranking
  computation and rating history are scoped per Season.
- Club — id, name, slug, externalCode (5 chars, e.g. "frogs", "skyln"), regionId (FK),
  city, state, zip, isActive, createdAt. Unique (externalCode, regionId) — confirmed
  from a real AES sample that the 5-char code alone is not globally unique (e.g.
  "skyln" is used by both a Dallas-area club under region NT and a Jacksonville-area
  club under region FL); the compound key is. `name` is admin-maintained (the "club
  code registry") rather than re-supplied by every event CSV, so a correction or
  first-time naming happens once and every future import referencing that code
  resolves for free.
- ClubContact — id, clubId, name, email, phone, title.
- User — id, email, name, role (SUPER_ADMIN|ADMIN|PENDING), status
  (PENDING|ACTIVE|DISABLED), createdAt. "Pending Users" = status PENDING.

### 1.2 Teams
*(See Deviations above — this section describes the original design; actual
implementation is `Team` + `TeamSeason`.)*
- Team — clubId? (nullable = "Unlinked Teams," a team whose club code didn't resolve
  to a known Club yet), name, ageGroup, teamNumber (distinguishes a club's multiple
  squads in the same age group, legacy's "17-1"/"17-2"), externalTeamCode (raw source
  code, e.g. "g14skyln1nt"), lineageKey, isActive.
- AES team codes are fixed-width and structured:
  `{gender:1}{ageGroup:2}{clubExternalCode:5}{teamNumber:1}{regionCode:2}` (e.g.
  "g14skyln1nt" = girls, 14u, club "skyln", team #1, region NT). Decoding this
  directly gives ageGroup, the Club's compound key, and teamNumber with zero fuzzy
  string matching — far more reliable than matching on the free-text display name
  (which also embeds the region in parens, e.g. "(NT)", redundantly with the code's
  trailing 2 chars — useful only as a cross-check).

### 1.3 Events / Divisions / Scoring
- Event — seasonId, name, slug, startDate, endDate, address fields, isAnchor (bool —
  flags USAV Girls Junior National Championships / Triple Crown NIT, exempt from the
  future suggestion algorithm).
- Division — eventId, name, slug, ageGroup, tierLabel (enum: OPEN, NATIONAL, AMERICAN,
  PATRIOT, LIBERTY, USA, FREEDOM), tierLevel (e.g. "I"/"II"), scoringStatus
  (DRAFT|SUGGESTED|CONFIRMED), ignoreAgeDefault.
- PointTemplate / PointTemplateBand — reusable point curve library (name, maxPoints,
  isAnchorTemplate, bands of fromRank/toRank/points; toRank=0 means open-ended tail).
- DivisionPointBand — the actual, frozen scoring truth for a division (copied from a
  template at confirm time, not a live FK to it, so later template edits don't
  retroactively change a confirmed division).
- DivisionScoringSnapshot — algorithm audit trail / state-machine record (not built
  yet — Phase 3). One Division can have many snapshots over time; latest is "current."

### 1.4 Finishes and the Two-Tier Rating Engine
- TeamFinish — divisionId, teamId, rank (may repeat for ties), tiebreakOrder (AES
  embedded seed/order number, display-only), points (resolved from DivisionPointBand
  at confirm time), ignoreAge. Source of truth for the official points-based ranking.
- Match — eventId, divisionId, teamAId, teamBId, matchDate, stage, setsA/setsB,
  setScores (JSON), winnerTeamId, externalMatchId (AES's numeric match id, for
  idempotent re-import). **Populated via the MATCH_RESULTS import — see §6 Phase 5 —
  but nothing consumes these rows yet** (Elo/Massey engines are the remaining Phase 5
  scope).
- TeamRatingHistory — weekly persisted snapshot: teamId, seasonId, ageGroup,
  weekEndingDate, ratingEngine (COLLEY|ELO), rating, rank, masseyRating?, masseyRank?.
  Not built yet — Phase 3 (Colley) / Phase 5 (Elo/Massey).
- MasseyRatingRun / MasseyTeamRating — Phase 5 only.
- RankingResult — materialized per-season/age-group official ranking: totalPoints,
  rank, npsRank/npsPoints (Colley today → Elo once Phase 5 ships), cpiRank/cpiPoints
  (null until Massey/Phase 5), ballotRank/ballotPoints, weightedRank,
  algorithmVersion. This reuses two legacy columns (NPS/CPI) that existed in v1 but
  were never wired up. **Currently implemented: totalPoints/rank/weightedRank only**
  (weightedRank = rank, no blending yet — see `algorithmVersion: "phase1-points-only"`
  in `computeRanking.ts`).
- RankingResultContribution — which finishes counted toward a team's top-3, powers the
  "your best 3 finishes, here's what didn't count" transparency view. **Built.**
- RankingWeightConfig — not built yet; official ranking stays pure points-based until
  the rating engine has a track record.
- Ballot / BallotEntry — stub only, not wired into scoring. Not built yet.

### 1.5 Import / Audit — ✅ Done (AES adapter, TEAM_FINISHES only; see §3)
- ImportBatch — eventId (an import batch targets a whole Event, not a single
  Division — see §3), source (AES|SPORTWRENCH|TM2|VBSCHEDULE|MANUAL, only AES is
  wired up), importType (DIVISIONS|TEAM_FINISHES|MATCH_RESULTS, only TEAM_FINISHES is
  wired up), status (DRAFT|RESOLVED|COMMITTED|FAILED), summaryJson (display cache of
  row-status counts), createdById. One ImportBatch spans multiple uploaded files (AES's
  "_part1/_part2..." splitting).
- ImportFile — importBatchId, filename, partNumber, rawContent (full CSV text, stored
  directly — no blob storage exists in this project), status, parseError, rowCount.
- ImportRow — staging row for the preview screen: raw AES columns (explicit typed
  fields, not a generic JSON blob, since AES's 4-column shape is fixed), parsed fields
  (ageGroup/tierLabel/tierLevel/tierWasDefaulted/clubExternalCode/teamNumber/
  regionCode/tiebreakOrder/cleanName), resolve output (status OK|WARNING|ERROR,
  messages, divisionMatchType/clubMatchType/teamMatchType EXISTING|NEW|AMBIGUOUS +
  matched ids, existingTeamFinishId for re-import idempotency), and admin overrides
  (overrideDivisionId/overrideClubId/overrideTeamId/overrideClubName/excluded — sticky
  across re-resolve).
- AuditFlag — written at commit time as an audit trail (NEW_CLUB, NEW_TEAM,
  NEW_DIVISION, REGION_MISMATCH, TIER_DEFAULTED, REIMPORT_UPDATE). Two rows resolving
  to the *same* team+division within one batch is a hard commit-blocking `ERROR`
  (`DUPLICATE_IN_IMPORT` at resolve time), not a post-commit audit flag — legitimate
  same-rank ties across *different* teams are unaffected and normal. No
  `/admin/flags` management UI yet (`resolved` field exists but nothing flips it) —
  that's Phase 6.

---

## 2. Two-Tier Rating Engine + Algorithmic Event-Strength Scoring (Phase 3 & 5 — not built)

The highest-risk, most novel part. Two goals: (a) a trustworthy team rating usable as
its own weekly power ranking, and (b) a field-strength signal for the point-curve
suggestion algorithm staff can review and confirm in one sentence.

**Tier 1 (Phase 3, ships first): Colley-style rating from placement data.** No new
data source needed — uses the standings data already captured via CSV import. The
Colley Matrix Method needs only win/loss records (no scores): for every pair of teams
in the same division where one's rank beats the other's, record one inferred "win."
Run as a weekly batch (plus immediately after anchor events are confirmed), solving
one linear system per (season, ageGroup) from every *confirmed* division's inferred
comparisons to date. Only confirmed divisions feed the graph, which also sidesteps the
"October event scored off March data" problem — a run's asOfDate strictly bounds which
confirmed events are included.

**Field-strength signal** for the suggestion algorithm: for each team in a candidate
division, look up its latest Colley rating, then compute three things from that same
rating list — kept separate, not blended into one hybrid number:
- **Bucket participation counts** (Top5/10/25/.../250, mirroring the legacy Analysis
  screen) — display/justification only, so staff can sanity-check against the
  breakdown they're already used to from v1. Not an input to the suggestion math.
- **Field Strength Score (FSS)** — mean Colley rating of the top 50% of teams in the
  division. Continuous rather than bucket-weighted, so a team just outside a bucket
  boundary doesn't swing the score. This is the number that actually drives the
  suggestion: map FSS to a suggested PointTemplate via percentile-based
  self-calibrating thresholds (admin-editable once real data suggests better fixed
  cutoffs).
- **Scale factor** — team count and match volume for the division. Weighted alongside
  FSS in the suggestion mapping, not blended into FSS itself: a large low-strength
  field shouldn't inflate the strength number, but should still be able to nudge the
  suggested tier at the margins (a 300-team field is arguably worth more than a
  20-team field of similar average strength). Exact weighting/formula is a Phase 3
  calibration detail, not decided yet.

**Suggest → Admin Confirms workflow**: admin sees FSS, percentile, bucket breakdown,
percentTeamsRated, confidence warnings (SMALL_FIELD, NO_HISTORY, LOW_PERCENT_RATED),
and the suggested template, plus two presentation aids for sanity-checking the number
rather than trusting it blind:
- A **Colley-rating distribution histogram** for the division (visual shape of the
  field, not just the summary stats).
- A **plain-language score band** alongside the raw percentile (e.g. "Elite field" /
  "Strong regional" / "Solid regional" / "Developmental") — exact band cutoffs TBD
  during Phase 3 calibration, analogous to interpretation bands seen on other
  volleyball-ranking sites.

Once weekly `TeamRatingHistory` snapshots accumulate (see Tier 1 above), the same
screen can also show how a division's FSS/suggested tier has shifted across prior
runs — useful since a division scored early in the season, before its region's other
results connect into the graph, can look weaker than it turns out to be.

Accept copies bands + confirms; Override requires a short reason (feeds future
recalibration). CONFIRMED divisions are excluded from future re-suggestion; editing
requires an explicit audited Unlock.

**Tier 2 (Phase 5): true Elo + Massey once match-level data exists.** *Important:*
match-level AES data turned out to already be reachable via AES's public,
unauthenticated results API — proven working in two sibling repos in this workspace
(`aes-tourney-director/services/matchSync.ts` and `AES Scraping/Match Results/
aes_match_results.py`, which already emits `match_results.csv` with real set scores).
So Phase 5 is **not** blocked on new scraper work for AES specifically — reuse that
fetch pattern. Sportwrench/TM2/VBSchedule match-level availability is still an open
question. Phase 5 is sequenced after Phase 3 by choice (validate the simpler rating
approach first), not because of a data-availability blocker.

- Elo: standard logistic update, `E_A = 1/(1+10^((R_B-R_A)/400))`,
  `R_A' = R_A + K*(S_A - E_A)`. Margin-of-victory refinement using set fraction won if
  per-set scores are available. Higher K while provisional (<10 season matches).
  Applied in strict matchDate order (path-dependent; backfills must replay
  chronologically).
- Massey: batch least-squares regression on point differential, with ridge
  regularization for early-season under-connected subgraphs. Run weekly + immediately
  after anchor events (exactly when previously-disconnected regions suddenly connect —
  Massey's simultaneous solve corrects the whole graph at once, where Elo's sequential
  updates are slow to reconcile).
- Cross-season carry-forward: seed each returning team's rating from last season's
  final value, regressed toward the mean (`newRating = mean + carryWeight *
  (oldRating - mean)`, default carryWeight 0.75).

---

## 3. CSV Import Pipeline (Phase 2 — ✅ Done: AES adapter, TEAM_FINISHES only)

**Pipeline stages, as built**: Start batch (event; source/importType fixed to
AES/TEAM_FINISHES this pass) → attach file(s) (multi-part support — AES exports split
past ~300 lines into "_part1/_part2...") → parse (`src/lib/import/aesCsv.ts`, header-
or-positional CSV parsing) → resolve (`src/lib/import/resolve.ts` — exact lookup via
AES's structured team code; re-runnable/idempotent, admin overrides survive
re-resolve) → preview (editable grid at `/admin/imports/[batchId]`, per-row
division/club/team override, "new club" name entry, row exclude) → commit
(`src/lib/import/commit.ts`, one transaction: creates new Divisions/Clubs/
Teams/TeamSeasons, upserts TeamFinish rows, writes AuditFlag rows, recomputes
rankings for every touched division).

**AES adapter specifics** (verified against a real 2026 USAV Girls Junior National
Championship 14-17 sample, 352 rows across 6 tiers — see
`docs/domain-notes.md`'s AES data format section): decode the team code
(`src/lib/import/aesTeamCode.ts`) into clubExternalCode/regionCode/ageGroup/
teamNumber/gender; **teamNumber is variable-width and not always numeric** — the real
sample had team numbers up to 23 (e.g. `g14afive23so`, the multi-region "A5" club
chain fielding 10+ teams under one shared code, widening the whole code past the
originally-assumed 11 characters), and at least one team used a lettered designator
instead of a digit (`g14nwrvbace` — team "a", confirmed as real/valid AES behavior).
`TeamSeason.teamNumber` and `ImportRow.parsedTeamNumber` are `String`, not `Int`, for
this reason. One AES file spans a whole event's age groups **and
tiers** at once (`ageGroupLabel` carried both in every row of the real sample, e.g.
"14 American" — parsed by `src/lib/import/divisionLabel.ts`; the OPEN-default+WARNING
fallback exists for the anchor-event case seen in an earlier, smaller Triple Crown NIT
sample but never triggered against this real file), not one file per division. A club
code that doesn't resolve to a known Club is staged as "new" — admin supplies a name
in the preview grid before commit (`overrideClubName`), and
every future import referencing that code resolves automatically once the Club exists.
An unresolved/mismatched region code is a `WARNING`, never a hard blocker or a silent
guess (see `docs/domain-notes.md` for why `Region.code` is seeded as "SC," not USAV's
own "SCSN," for Southern California / Southern Nevada — AES data always uses "sc").

**Manual/Generic adapter**: not built this pass — deferred along with Sportwrench/
TM2/VBSchedule (still no confirmed sample formats, Open Question 1 below), the
DIVISIONS/MATCH_RESULTS import types, and a dedicated `/admin/flags` AuditFlag-
management UI (Phase 6).

---

## 4. Ranking Computation (Phase 1 shipped a subset; full version is Phase 3+)

**What's built** (`src/lib/ranking/computeRanking.ts`): materialized `RankingResult`
per (season, ageGroup), recomputed on trigger (division confirm/unlock) — not
recomputed per page view. Gathers CONFIRMED-division finishes, resolves each team's
"natural" age group for the `ignoreAge` case via `TeamSeason` (not `Team.ageGroup`, per
the Deviations section), sums best-3 points, ranks with competition-style ties,
writes `RankingResult` + `RankingResultContribution` in one transaction.

**Not yet built**: npsRank/cpiRank population (waits on Phase 3/5's rating engines),
weightedRank blending (waits on RankingWeightConfig, Phase 6), the Analysis view
(strength-of-field Top5/10/25/.../250+ breakdown per event+division — Phase 3, doubles
as the suggestion algorithm's justification UI).

---

## 5. Admin UI Structure — routes built vs. planned

Built (Phase 0/1):
`/admin`, `/admin/seasons`, `/admin/events`, `/admin/events/new`,
`/admin/events/[eventId]`, `/admin/events/[eventId]/divisions/[divisionId]`,
`/admin/point-templates`, `/admin/point-templates/[templateId]`, `/admin/teams`,
`/admin/teams/[teamId]`, `/admin/clubs`, `/admin/clubs/[clubId]`, `/admin/regions`,
`/admin/rankings`, `/admin/rankings/[seasonId]/[ageGroup]`, `/admin/users`.

Built (Phase 2): `/admin/imports` (list + start batch), `/admin/imports/[batchId]`
(upload/resolve/preview/commit workflow).

Built (Phase 3, first slice): `/admin/power-rankings` (season/age-group selector +
manual recompute trigger), `/admin/power-rankings/[seasonId]/[ageGroup]` (Colley
ratings table).

Built (Phase 3, second slice): `/admin/events/[eventId]/divisions/[divisionId]/scoring`
(generate suggestion, view FSS/percentile/band/bucket counts/warnings, Accept/Override,
now also the Colley-rating distribution histogram).

Built (Phase 3, third slice): `/admin/analysis` (season/age-group selector),
`/admin/analysis/[seasonId]/[ageGroup]` (per-division FSS/percentile/band/bucket-count
breakdown across a whole season/age group).

Built (Phase 5, first slice): `/admin/imports` gained a Type selector (Team
Finishes/Match Results); `/admin/imports/[batchId]` renders a dedicated
fetch/re-fetch + read-only match table + skipped-reasons view for `MATCH_RESULTS`
batches instead of the ImportRow grid.

Built (Phase 5, second slice): `/admin/power-rankings` gained a "Recompute Elo
ratings" button; `/admin/power-rankings/[seasonId]/[ageGroup]` shows Colley and Elo
side by side as columns in one merged table.

Built (Phase 5, third slice): `/admin/teams/[teamId]`'s existing "Match Results"
section gained inline Elo columns (rating before → after, delta) and an expandable
"why" panel per match, instead of a separate duplicate section.

Built (Phase 5, fourth slice): `/admin/analysis` and the division scoring-review
screen gained Engine/Elite % columns, reflecting the new Elo/DCI path in
`computeDivisionScoringSuggestion.ts`.

Planned, not built: `/admin/teams/unlinked`, `/admin/teams/inactive`,
`/admin/clubs/unlinked`, `/admin/clubs/inactive` (Phase 2 follow-up audits),
`/admin/flags` (Phase 6), `/admin/ballots` (Phase 6).

---

## 6. Phased Build Roadmap (detail)

**Phase 0 — Foundations.** ✅ Done. Repo scaffold, Prisma + local dev Postgres (via
`prisma dev`, no Docker), base schema, Auth.js credentials-based auth with a Pending
Users approval workflow, Edge-safe proxy gating `/admin/*`.

**Phase 1 — Manual parity core.** ✅ Done (see Status above). Event/Division CRUD,
PointTemplate CRUD + band editor, manual point-curve assignment, TeamFinish
entry/reorder, top-3-of-season ranking + Rankings view. Shippable v1 functional
parity, worked entirely by hand.

**Phase 2 — CSV import pipeline.** ✅ Done for AES/TEAM_FINISHES (see §3):
multi-file-per-batch support, AES adapter (decode + division-label parsing, verified
against a real 352-row USAV Nationals sample), resolve/preview/commit workflow,
AuditFlag audit trail.
**Not built**: Manual/Generic adapter; Sportwrench/TM2/VBSchedule adapters (still no
confirmed sample formats — Open Question 1); DIVISIONS/MATCH_RESULTS import types;
fuzzy team/club matching beyond AES's structured code; Unlinked/Inactive audit list
pages (`/admin/teams/unlinked` etc.); region-code alias reconciliation table.

**Also planned**: streamline event creation + import into one flow off the event
screen — today, creating an Event (`/admin/events/new`) and starting an import batch
for it (`/admin/imports`) are separate flows the admin has to stitch together by hand;
the goal is to let staff go from "new event" straight through to uploading/resolving
its import files without leaving `/admin/events/[eventId]`.

**Phase 3 — Tier 1 rating engine (Colley) + algorithmic scoring.** ✅ Done. Colley
batch solve + `TeamRatingHistory` snapshot + a basic Power Rankings view, FSS
computation + suggestion generation + the Division scoring-review screen +
`DivisionScoringSnapshot` audit trail + the Colley-rating distribution histogram, the
Analysis view, the non-anchor `PointTemplate` library, and the prior-run FSS-history
comparison table on the scoring-review screen (see Status above).

**Phase 4 — Cross-season bootstrapping and calibration.** Not started. Prior-season
carry-forward with regression-to-mean; calibrate FSS thresholds against real
historical data; confidence/warning banners; capture override-reason data.

**Phase 5 — Tier 2 upgrade (Elo + Massey).** In progress. Match Results import type
✅ done (AES only, see Status above — ported the per-team `schedule/past` fetch
approach from `AES Scraping/Match Results/aes_match_results.py`, not
`aes-tourney-director`'s live-sync `matchSync.ts`, since this is a one-shot
historical pull rather than a continuously-polled live-scoring sync). Incremental Elo
with chronological backfill ✅ done (see Status above). **Not started**: periodic
Massey cross-check, CPI activation, Power Rankings switches from Colley to Elo
labeling (both shown side-by-side today).

**Phase 6 — Polish.** Not started. Team Finish Error/Flags workflow, Ballots stub,
ClubContacts, RankingWeightConfig UI, background-job infra for recompute/weekly jobs,
hosting finalization. Also planned: a manual per-division point-band override — let
staff bump a confirmed division's `DivisionPointBand` points by a small amount (e.g.
+1/+2) without having to swap the whole `PointTemplate` applied to it, for cases where
the algorithmic/template suggestion is close but not quite right for that one division.
Also planned: a bulk/batch way to (re)generate scoring suggestions across many
divisions at once (e.g. a whole event, or every still-DRAFT division in a season),
instead of only the current one-division-at-a-time flow on the scoring-review screen —
matters more now that Colley/Elo recompute is a manual trigger and division counts per
event can be large (e.g. the 352-row USAV Nationals sample spans 6 tiers).

---

## 7. Open Questions / Assumptions Still Unconfirmed

1. Sportwrench/TM2/VBSchedule export formats still unknown — only AES has a confirmed
   real sample. Also unknown: whether any of the three use a stable structured
   club/team code (enabling exact-lookup like AES) or only free-text names.
2. `ignoreAge` semantics assumed to mean "this finish counts toward the team's natural
   age-group ranking even though the division's age group differs" — this is what's
   implemented (`computeRanking.ts` resolves natural age group via `TeamSeason`), but
   not confirmed against legacy v1 behavior.
3. Division "Tier" — modeled as two orthogonal fields (tierLabel: Open/National/
   American/etc., tierLevel: I/II/III) — not confirmed these are genuinely orthogonal
   in the legacy data.
4. AES division bulk-upload: confirm whether a second real sample export shows the
   same file implying both divisions and finishes together, or a separate step exists.
5. No legacy data export available to calibrate FSS-to-tier thresholds — percentile-
   based self-calibrating defaults proposed for Phase 3.
6. Hosting is open — no default chosen yet (Vercel + Neon/Supabase was suggested
   during planning, not decided).
7. Tie/band-boundary point rules assumed to directly copy legacy behavior (shared rank
   gets shared points — this is what's implemented). `tiebreakOrder` (AES's embedded
   seed number) assumed to have no scoring implication beyond display/ordering.
8. Ballot logic unspecified beyond "currently unused" — deferred, stub only.
9. AES club codes assumed permanent/stable identifiers issued once per club (not
   reused across seasons) — this is what makes them safe as a durable Club key and a
   reliable `lineageKey` input. Not independently confirmed.
10. Colley/Elo/Massey tuning constants (bucket weights, carryWeight, K-factor, ridge
    strength) are reasonable defaults from established practice, not calibrated to
    this dataset — Phase 4/5 calibration passes are where these get tuned.
11. `aes-tourney-director`'s exact AES fetch pattern (`lib/aesFetch.ts` and
    `services/matchSync.ts` — endpoint shape, headers/UA spoofing, timeout/retry
    handling) should be reviewed before writing Phase 5's Match Results fetcher.
12. `miva-data` (a sibling repo in this workspace) contains MIVA match/team results —
    a possible 5th data source beyond the named four, not yet scoped into this plan.
13. **Club ranking (future phase, not yet scoped/sequenced)**: a club-level ranking
    is planned in addition to the existing team-level (best-3-of-season) ranking, with
    its own methodology — explicitly *not* a copy of VolleyLens' Elo-blended club
    score. **Needs to be scoped out**: the existing (legacy/v1) methodology, published
    at https://www.usclubrankings.com/methodology.html, is the intended starting point
    to carry forward here — not yet reviewed/translated into a design for this rebuild.
    Not yet designed; will need its own phase entry once methodology is scoped.
    Related need identified 2026-07-27: a way to designate multiple
    `Club.externalCode`s (e.g. a club that changed/re-registered its AES code across
    seasons, or fields under more than one code) as the *same* club for club-ranking
    purposes — some kind of club-alias/grouping mechanism, needed once club rankings
    are actually built.
