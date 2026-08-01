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

Scope for this plan originally excluded a public-facing rankings website; that
changed (2026-07-30) — a read-only public section (`/rankings`) was added in-repo
alongside the admin app (not a separate app), showing events/divisions/finishes and
the same NPS/Power/Combined team rankings views as `/admin/team-rankings`. It
requires no login and is structurally isolated from `/admin` (its own top-level
route, untouched by `src/proxy.ts`'s `/admin/:path*` matcher) — see §5.

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
| 5 | Tier 2 upgrade (Elo + Massey from real match data) | In progress (MATCH_RESULTS import ✅; Elo engine ✅; Massey engine ✅, incl. division-strength weighting; CPI activation dropped; Colley→Elo default-labeling relabel not started) |
| 6 | Polish — flags, ballots, weight config, background jobs, hosting | Not started |
| 7 | Club-level ranking (new tier, alongside existing team ranking) | Not started — methodology scoped from legacy site, see §8 |

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
**Phase 5, fifth slice — Massey engine — done.** `src/lib/rating/massey.ts` (pure:
standard Massey Matrix Method — for a match between teams i/j with signed point
differential `d` (i's advantage over j), `M[i][i] += 1, M[j][j] += 1, M[i][j] -= 1,
M[j][i] -= 1, b[i] += d, b[j] -= d`, then solved via the same hand-rolled Gaussian
elimination style as `colley.ts` — each rating module stays self-contained rather than
sharing a solver across files. `computeMatchPointDiff()` sums every set's real
`(a - b)` across the whole match (all sets, not just the deciding one) — real per-set
scores were already being imported via `Match.setScores`
(`src/lib/import/aesMatches.ts`'s `AesMatchSetScore`, sourced from AES's actual
`FirstTeamScore`/`SecondTeamScore` per set), just not consumed by anything until this
slice; `setsA`/`setsB` are a *derived* summary of those same real scores, not the
underlying data itself. The Massey matrix is singular by construction (rows sum to
zero) — per `docs/plan.md`'s own Tier-2 design, fixed via **ridge regularization**
(`DEFAULT_RIDGE_LAMBDA` added to every diagonal entry) rather than Colley's
row-replacement trick; this also naturally damps small/disconnected early-season
subgraphs instead of needing a separate connectivity check, unit-tested including an
isolated-pair case that would be exactly singular without the ridge term.
`computeMasseyRatings.ts` mirrors `computeEloRatingsForPartition()` exactly (same
per-`(season, ageGroup)` partitioning, ignoreAge resolution, and delete-and-replace
`TeamRatingHistory` write) and reuses the *same* `getPartitionMatches()` helper Elo
already built (exported from `computeEloRatings.ts` rather than re-deriving the
partition/ignoreAge logic a third time). New `MASSEY` value on the `RatingEngine`
enum — no separate `MasseyRatingRun`/`MasseyTeamRating` models, following Elo's own
precedent of reusing the shared `TeamRatingHistory` table instead of the original
plan's now-stale separate-model sketch (§1.4). Like Elo, Massey has no
standings-inferred fallback: a division with finishes but no imported `Match` rows
contributes nothing. `/admin/power-rankings` gained a third "Recompute Massey
ratings" button; the ratings-detail page adds Massey Rank/Rating/Games as a third
column group, with any Massey-only team (not already covered by Colley or Elo)
appended after both, `—` where a team isn't yet rated by an engine. Verified
end-to-end in the browser against the real 2026 Triple Crown Colorado Challenge 14u
data already in the dev DB: Massey and Colley/Elo independently agree on the top team
(Legacy 14-1 ADIDAS ranks #1 in both Colley and Massey, #2 in Elo) despite being a
fully independent computation over point differentials rather than win/loss or
sequential updates — the same kind of reassuring cross-check the Elo/Colley agreement
gave in the second slice, not a coincidence the code enforces.

**Bug fix (all three engines) — cross-age-group rating leak.** While verifying the
Massey slice above, found that a division qualifies as "relevant" to an age-group
partition as soon as *any one* team's finish belongs there, but every match/comparison
in that division was being pulled into the graph and solved — including a team playing
up from a different natural age group (e.g. a 15u team playing up into a 17u
division). Colley/Elo/Massey all return a rating for every team in the graph they're
handed, so that playing-up team's own rating was getting persisted into the *wrong*
age group's `TeamRatingHistory` rows (visibly: a 15u team showing up in the 17u power
rankings table). Fix: keep pulling in the full division's matches when *solving* (an
opponent's real strength should reflect having faced that tough playing-up team), but
filter the final ranked list down to `relevantTeamIds` — teams whose own natural age
group actually matches the partition — before ranking/persisting.
`getPartitionMatches()` (`computeEloRatings.ts`) now returns `{ matches,
relevantTeamIds }` instead of a bare match array; `computeColleyRatings.ts` builds the
equivalent set inline. This predates the Massey slice — it affected the already-shipped
Colley (Phase 3) and Elo (Phase 5) engines too, just hadn't surfaced yet since no one
had inspected an age group with a playing-up team's rating leaking in until this
session. Verified end-to-end against the real dev DB data that exposed it (a 2025-2026
15u DYNASTY team that had been appearing in the 17u Colley/Elo/Massey tables) — gone
from all three after recompute, with no change to genuinely-17u teams' own ratings
(the graph they're solved against is unchanged, only the persisted row set is
filtered).

**Elo division-strength weighting.** `src/lib/rating/elo.ts`'s `replay()` gained a
third multiplicative factor alongside K and the margin multiplier: `divisionWeight`
(defaults to 1 if omitted — every pre-existing `elo.test.ts` case still passes
unmodified). The signal: `src/lib/rating/divisionWeight.ts`'s `computeDivisionWeight()`
ranks a division's Colley FSS percentile (reusing `computeDivisionFieldStrength.ts` +
`suggestPointTemplate.ts`'s `computeFssPercentile()` — no new percentile math)
against every *other* division's percentile currently known in the same
`(season, ageGroup)` partition — an empirical rank transform (quantile
normalization), not a fixed floor/ceiling. Deliberately Colley-only, never the
Elo/DCI-based percentile `computeDivisionScoringSuggestion.ts` sometimes uses instead
— using an Elo-derived signal to weight Elo itself would be circular; Colley never
reads an Elo rating anywhere, so Colley → Elo weighting is one-directional. New
`src/lib/rating/computeMatchDivisionWeights.ts` (orchestration) gathers that whole
per-partition reference population (every division with any `TeamFinish` in the
partition, not just the ones with matches) and builds the `Map<divisionId, weight>`
`computeEloRatings.ts`'s `withDivisionWeights()` helper attaches to each match before
`buildEloMatches`/`solveElo`/`computeEloHistory`.

A first version anchored the range at fixed percentile cutoffs (`[0, 95] ->
[0.7, 1.6]`, the ceiling checked against real NIT/Nationals Open divisions landing
93.3–98.9), but verifying it against real data found a real problem: all 24 real 14u
divisions with trustworthy Colley signal actually spanned percentile **53.3–98.1**,
not 0–100 — a division needs enough Colley-connected teams to get a trustworthy
signal at all (the existing `LOW_PERCENT_RATED` gate filters out the rest), so almost
no real division lands below ~50th percentile. That meant the fixed floor wasted its
entire bottom half on percentiles that essentially never occur — a division staff
scored at only 50 points (clearly meant to be weak) landed at percentile 71.7 -> weight
1.38, most of the way to the ceiling. The rank-transform version fixes this by
construction: ranking against the *live* population of division percentiles instead
of fixed anchors, so the weakest division currently known always gets `WEIGHT_MIN`
and the strongest always gets `WEIGHT_MAX`, evenly spread between — no floor/ceiling
constant to guess or revisit as more of the season's divisions get scored. Verified
against real 2025-2026 14u data after the fix: the same 24 divisions now spread evenly
from weight 0.700 ("26 The Nike Classic / 14 Premier", percentile 53.3) to 1.600
(USAV Nationals 14 Open, percentile 98.1), with Triple Crown NIT 14 Open close behind
at 1.561 and — the case that specifically motivated this — USAV Nationals' own weaker
tiers within the *same anchor event* (14 Liberty/Freedom, weight 1.170) landing well
below its own Open division, proving the weighting is genuinely division-strength-based
rather than a flat anchor-event boost. Also spot-checked end-to-end on a real team
(Boss CLE 14-2): its early-season matches in the weakest division (weight 0.7,
provisional K=40) and its later USAV Nationals American-tier matches (weight 1.209,
base K=24) produced similar real rating swings despite the different K bucket
(effective K×weight ≈28 vs ≈29) — the weighting compensating sensibly, not just
applying a cosmetic multiplier. Scoped to Elo only for this pass; Massey's analogous
weighting (scaling matrix entries rather than a K-factor) is a natural follow-up, not
yet built.

`/admin/analysis`'s division detail page gained an "Elo Weight" column (a new exported
`computeDivisionWeightsForPartition(seasonId, ageGroup)` in
`computeMatchDivisionWeights.ts`, factored out of `computeMatchDivisionWeights()` so
both share one implementation) — a live, on-demand view of the same number Elo
recompute would use to weight that division's matches, shown next to the existing
Band/Pctl columns. Deliberately kept as a separate column rather than merged into
Band: Band's percentile is sometimes Elo/DCI-based depending on a division's own match
coverage, while Elo Weight is always Colley-only (per the circularity concern above),
so the two numbers answer different questions and don't generally agree. Verified in
the browser against real 14u data: Elo Weight populates even for DRAFT divisions with
no scoring snapshot at all (Band/Pctl show "—", Elo Weight still shows a real number),
confirming the two are genuinely independent computations, not just two views of the
same underlying value. The Analysis page column has since been relabeled "Rating
Weight" (see below) now that it applies to both engines.

**Massey division-strength weighting.** The Massey analog of the above: same
Colley-only `computeDivisionWeightsForPartition()` weight, same
`computeMatchDivisionWeights.ts`/`withDivisionWeights()` plumbing (now exported from
`computeEloRatings.ts` so `computeMasseyRatings.ts` reuses the identical per-division
weight map rather than recomputing it a second, potentially-inconsistent way), but
applied to Massey's batch least-squares solve instead of Elo's sequential K-factor.
Massey has no K to scale, so `massey.ts`'s `solveMassey()` scales each match's
contribution to the normal-equations matrix directly — `M[i][i] += w`, `M[j][j] += w`,
`M[i][j] -= w`, `M[j][i] -= w`, `b[i] += w*d`, `b[j] -= w*d` — standard
weighted-least-squares, since the Massey matrix already *is* the normal-equations
matrix of a least-squares fit. `divisionWeight` defaults to 1 (neutral) if omitted, so
every pre-existing `massey.test.ts` case still passes unmodified. Deliberately not
scaling `ridgeLambda`: ridge is a per-team regularization term, not a per-match
observation, so it stays independent of any individual match's weight. The Analysis
page's per-division weight column (`/admin/analysis`) is relabeled "Rating Weight"
(was "Elo Weight") now that the same number drives both engines.

**CPI activation — dropped (2026-07-29).** `npsRank`/`npsPoints`/`cpiRank`/`cpiPoints`
on `RankingResult` (§1.4) were carried-forward legacy v1 column names, not a
rediscovered legacy methodology — no v1 export or spec exists (Open Question 5). Per
explicit user decision, not pursued: Combine Rankings' Avg Rank (see the entry above)
already gives a Massey-inclusive blended number, so a separate Massey-only CPI column
would be redundant rather than additive. `RankingResult` stays as built
(`totalPoints`/`rank`/`weightedRank`/`algorithmVersion` only — `weightedRank` still
just copies `rank`, no blending). Future rating-engine work should default to tuning
the existing Colley/Elo/Massey algorithms (calibration constants, weighting) rather
than adding new composite-score columns.

**Power Rankings default/primary labeling — resolved as the blended Avg Rank
(2026-07-29).** Per explicit user decision, Power Rankings' "primary" view is the
Avg Rank blend added for Combine Rankings (Colley/Elo/Massey rank-averaged), not a
promotion of any single engine to "default" the way the original plan assumed. Power
Rankings gained a leading ordinal **Rank** column (`team-rankings/page.tsx`'s
`PowerRankingTable`) — an actual rank position by Avg Rank order, computed once via
`sortRows(defaultRows, averagePowerRank, "asc")` into a `teamId -> position` map and
displayed as a real "1, 2, 3..." column (mirroring NPS Rankings' own persisted `rank`
column) rather than just a raw averaged number staff had to interpret themselves. The
position stays fixed to Avg Rank order even when the table is sorted by a different
column (clicking "Colley Rank" re-sorts the row order but each row still shows its
Avg-Rank-based Rank number), same convention as NPS's `rank` column. Colley/Elo/Massey
remain visible as their own columns for staff who want the underlying detail — this
isn't a removal of the per-engine views, just a headline number placed in front of
them.

**Periodic recompute — done (2026-08-01).** `src/lib/jobs/nightlyRecompute.ts` (Prisma
orchestration: for every active `Season`, sequentially reruns
`computeColleyRatingsForSeason`/`computeEloRatingsForSeason`/
`computeMasseyRatingsForSeason` — the same three engines "Recompute ratings" on
`/admin/team-rankings` triggers by hand — then `computeDivisionScoringSuggestion` for
every division in that season, `preserveStatus`d for already-CONFIRMED divisions
exactly like `/admin/analysis`'s "Run analysis for all divisions" bulk action) plus
`src/lib/jobs/scheduleNightlyRecompute.ts` (a hand-rolled `setInterval` poll — no new
cron dependency — comparing wall-clock time in `America/New_York` against a fixed
2 AM target hour, guarded so it fires at most once per calendar day). Started from
`instrumentation.ts`'s `register()` hook (Next's documented once-per-server-start file
convention), Node runtime only. Runs in-process rather than via the `execFile` worker
pattern the request-triggered buttons use (`recomputeRatingsInWorker.ts`) — that
workaround exists to dodge Cloudflare's ~100s proxy timeout on a synchronous HTTP
request, which doesn't apply to a background timer with nothing waiting on it. This is
a single-process scheduler: correct for the current one-replica homelab deploy
(`docker-compose.prod.yml`), but would double-run if the app were ever scaled to
multiple replicas — a real job queue (BullMQ+Redis, or a DB-polling table, per the
"Resolve performance" note in §3) would be needed at that point. Manual
"Recompute ratings"/"Run analysis for all divisions" buttons remain — this doesn't
replace them, just means staff no longer have to remember to click them daily. Closes
the "periodic/scheduled Massey cross-check re-run" gap this section used to note as
missing.

Sportwrench match-level fetching is also done (`sportwrenchMatches.ts`, alongside the
existing `sportwrenchStandings.ts`/TEAM_FINISHES coverage) — **not yet built**: TM2/
VBSchedule match-level fetchers.

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
  were never wired up. **Deviation: `npsRank`/`npsPoints`/`cpiRank`/`cpiPoints` were
  never added — see the "CPI activation — dropped" entry in Status above; "NPS
  Rankings" in the UI is a display label on `totalPoints`/`rank`, not these columns.**
  **Currently implemented: totalPoints/rank/weightedRank only**
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

**Resolve performance** (2026-07-31): clicking Resolve/Re-resolve on a large batch was
pinning the whole app's CPU, observed as a real spike on the homelab docker host.
Two fixes, in order of how much of the problem each solves:

1. `resolveImportBatch` (`src/lib/import/resolve.ts`) used to load *every* Club and
   every lineage-keyed Team in the entire database (`prisma.club.findMany()` with no
   filter at all) to resolve one event's batch — a query that only gets heavier as
   more seasons/events accumulate, regardless of how big the batch itself is. It now
   decodes every row's team code up front, collects just the club codes / lineage
   keys the batch actually references, and scopes both queries to `{ in: [...] } }`
   against that small set. This was the dominant cost.
2. The remaining CPU-bound work (looping over every row, doing per-row string
   parsing/lookups) still runs synchronously and would otherwise block the same
   thread Next uses to serve every other admin request for the batch's whole
   duration. `resolveBatch` (the server action) now runs it in a separate process
   instead, via the shared `runInWorker.ts` helper (`resolveInWorker.ts` /
   `resolveWorkerEntry.ts`).

   **This took three attempts to get right, and it's worth understanding why**, since
   the failure mode only ever showed up in a real Docker build against the real
   bundled server action — never in `next dev`, never in a standalone script, and not
   even consistently across Docker builds of identical code:
   1. `node:worker_threads`' `new Worker(...)`. Next's own "Magic Comments" docs
      confirm Turbopack intercepts `new Worker(...)` expressions to bundle/resolve
      the target at build time. The *build* succeeded, but the generated runtime
      moduleContext lookup was unreliable — it worked in one Docker build and threw
      `Cannot find module '.../resolveWorkerEntry.ts'` in another, for
      byte-identical code, confirmed live on the homelab docker host. Neither the
      documented `/* turbopackIgnore: true */` escape-hatch comment nor obscuring the
      `Worker` identifier (fetching the constructor off the `node:worker_threads`
      namespace object via a computed property, so there's no literal `new Worker(`
      text anywhere) fixed it reliably.
   2. `child_process.fork(...)`. Not in Turbopack's documented list of intercepted
      expressions, but intercepted anyway, and more aggressively — the *build itself*
      failed ("Module not found: Can't resolve './ROOT/src/lib/import'") regardless
      of how the path argument was constructed (`path.join`, plain string
      concatenation, even base64-decoding the directory segment so there was no
      path-shaped string literal anywhere in the file). Turbopack appears to
      intercept any non-literal first argument to `fork(...)`, not the string's
      actual content.
   3. `child_process.execFile(...)` — what's actually shipped. `execFile` runs an
      executable (`process.execPath`, i.e. `node`) with argv; it shares no
      module-loading shape with anything Turbopack special-cases. No IPC channel
      (unlike `fork`), so the task payload goes in as a JSON argv string and the
      result comes back as the last line the child prints to stdout. Confirmed
      stable across a `--no-cache` Docker rebuild, verified against the real bundled
      server action (not a standalone script) by actually clicking Resolve through
      the UI.

   `tsx` is a real, not dev, dependency (it's what runs the plain, unbundled worker
   entry `.ts` files), and the Dockerfile's runner stage copies `src/`,
   `tsconfig.json`, and the full (unpruned) `node_modules` rather than relying on
   Next's traced `.next/standalone` output for this one path — none of that changed
   across the three attempts above, only the process-spawning mechanism did.

This is deliberately the *lightest* fix, not full process isolation via a job queue.
If Resolve passes ever grow so long/frequent that they need to survive a page
navigation or want progress reporting, the next step up is **a real job queue +
separate worker container** (BullMQ+Redis, or a DB-polling table) — the "Resolve"
button enqueues and returns immediately, a separate `docker-compose` service
processes it, and the UI polls/refreshes for status. That's the architecturally
"correct" answer for background work, but is a meaningfully bigger change: new
service, new dependency, and an async UI instead of this app's current synchronous
redirect-after-action pattern (see `src/app/admin/CLAUDE.md`'s "Error handling"
section). `execFile`-based process isolation (what's shipped) already gets you most
of the practical benefit — the main thread stays responsive, and the work keeps
running to completion independent of the triggering HTTP request — without that
added complexity.

The process-spawning plumbing above was factored out into
`src/lib/import/runInWorker.ts` so it isn't duplicated — see below.

**Match Results import performance** (2026-07-31, same session): fetching+committing
Sportwrench match results for a 900-team event produced a Cloudflare `524` (gateway
timeout) on the homelab docker host, which sits behind a Cloudflare Tunnel. Root
cause was different from Resolve's: `fetchSportwrenchMatchResults`
(`src/lib/import/sportwrenchMatches.ts`) fetched each team's match history with one
sequential `curl` subprocess call per team — 900+ sequential external round-trips,
5-8+ minutes of wall time, far past Cloudflare's ~100s proxy timeout (not
meaningfully raisable outside an Enterprise plan, so the fix has to be code-side).
Two changes:

1. **Bounded concurrency**: `mapWithConcurrency` (`src/lib/import/concurrency.ts`,
   tested in `concurrency.test.ts`) runs up to `TEAM_FETCH_CONCURRENCY` (12) of these
   curl calls at once instead of one at a time — verified in the actual prod Docker
   image against a real 255-team Sportwrench event (Florida Fest JNQ): the full
   fetch+resolve+commit dropped from what would have been minutes to ~5.4s. Kept
   deliberately conservative (not unbounded) to stay clear of Sportwrench's Cloudflare
   bot protection (the reason `sportwrenchFetch.ts` shells out to curl at all).
2. **Off the main process**: `importAesMatchResults`/`importSportwrenchMatchResults`
   now also run via `runInWorker` (`src/lib/import/commitMatchesInWorker.ts` /
   `commitMatchesWorkerEntry.ts`) — same mechanism as Resolve (see that note above
   for why it's `execFile`, not `worker_threads`/`fork`), but a different reason: the
   dominant cost here is wall-clock-bound external I/O, not CPU. Moving it to a
   separate process keeps the app responsive to other admins during a big import, but
   — unlike Resolve — does **not** make the triggering request return any faster
   (Cloudflare will still 524 the *browser* if the import runs past ~100s regardless
   of which process runs it). The concurrency fix above is what actually avoids the
   524; the separate process is what keeps a still-slow one from starving everyone
   else, and means the import keeps running and committing even after Cloudflare has
   already shown the requesting admin an error page.

**Team rankings recompute performance** (2026-07-31, same session): clicking
"Recompute ratings" on `/admin/team-rankings` produced the same Cloudflare `524` as
the two problems above, for the same reason as Resolve — synchronous, unscoped-ish
work run inline in the server action. `recomputeAll` runs Colley, Elo, and Massey
sequentially, each of which refetches a season's match/finish data (with heavy
`event`/`division`/`teamA+club`/`teamB+club` includes) once per age group, then used
to persist results with a `for` loop doing one `tx.teamRatingHistory.create()` per
team — for a season with hundreds of teams across 7 age groups × 3 engines,
thousands of sequential single-row inserts. Two fixes, same shape as before:

1. **Batched writes**: `computeColleyRatings.ts`/`computeEloRatings.ts`/
   `computeMasseyRatings.ts` each now do one `tx.teamRatingHistory.createMany(...)`
   per (engine, age group) instead of a per-team `create()` loop.
2. **Off the main process**: `recomputeAll` now calls `recomputeRatingsInWorker`
   (`src/lib/rating/recomputeRatingsInWorker.ts` /
   `recomputeRatingsWorkerEntry.ts`) — same `runInWorker`/`execFile` mechanism as
   Resolve and the match-results import, called with the path relative to `src/`
   (`runInWorker.ts` was generalized to accept that instead of assuming everything
   lives under `src/lib/import/`, since this one lives under `src/lib/rating/`).
   Verified end-to-end in a `--no-cache` Docker rebuild by actually clicking
   "Recompute ratings" through the real UI: full three-engine recompute for a real
   season completed in ~40s, well under Cloudflare's ~100s timeout, with fresh
   ratings visible on the Power Rankings tab afterward.

The redundant per-age-group refetching within each engine (each of Colley/Elo/Massey
re-queries the same season's matches independently, once per age group) was NOT
addressed here.

**Correction, same day**: the two fixes above weren't enough on the actual homelab
docker host's hardware — a real recompute there completed successfully (confirmed via
`TeamRatingHistory.createdAt`, which the admin UI didn't display until this fix) but
still occasionally ran long enough to hit Cloudflare's `524` anyway, since the
request was still `await`-ing the full duration even though the work had moved to a
separate process. Running work off-process only helps the *rest of the app* stay
responsive; it does nothing for the *triggering* request's own exposure to a
fronting proxy's timeout, since that request is still open the whole time it waits.

The actual fix: `recomputeAll` no longer `await`s `recomputeRatingsInWorker(...)` at
all — it's fire-and-forget (with a `.catch()` so a background failure doesn't crash
an unrelated request), and the server action redirects immediately with a "recompute
started" message instead of "recomputed." The worker process keeps running
independently of the request regardless. This is the same realization that motivates
the "job queue + separate worker container" alternative noted for Resolve above, just
implemented here in the minimal way this button needed rather than a general queue:
no new service, just "don't make the browser wait." The trade-off: the button can no
longer promise the work is *done* by the time it redirects — only that it *started*.
`getLatestPowerRatings` now selects `TeamRatingHistory.createdAt` (not just
`weekEndingDate`, which collapses every same-day recompute onto one value by design)
so the Power/Combined Rankings "as of" line shows the actual run time, letting an
admin verify a recompute actually finished without needing DB access.

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

Built (Phase 5, fifth slice): `/admin/power-rankings` gained a "Recompute Massey
ratings" button; `/admin/power-rankings/[seasonId]/[ageGroup]` shows Massey as a
third Rank/Rating/Games column group alongside Colley and Elo in the same merged
table.

**Public UI Structure (2026-07-30).** A new top-level, no-login route tree,
`src/app/rankings/` — untouched by `src/proxy.ts`'s `/admin/:path*` middleware
matcher, so no auth work was needed. Read-only mirrors of existing admin queries,
no server actions, no links into any `/admin/*` route:
- `/rankings` — redirects to `/rankings/events`.
- `/rankings/events` — event list (mirrors `/admin/events`, no "New event" action).
- `/rankings/events/[eventId]` — divisions list for the event (mirrors
  `/admin/events/[eventId]`, drops `importBatches` and all edit forms).
- `/rankings/events/[eventId]/divisions/[divisionId]` — read-only team finishes table
  (mirrors `/admin/events/[eventId]/divisions/[divisionId]`, drops the point-band/
  finish edit forms and template/available-teams data).
- `/rankings/team-rankings?season=&view=nps|power|combine&ageGroup=&sort=&dir=` —
  same three tabs as `/admin/team-rankings`, same query-param contract, but no
  recompute button/action and no team-name links into `/admin/teams/[teamId]`.

Shares `sortRows`/`ordinalSuffix`/`getLatestPowerRatings`/`buildPowerRows`/
`averagePowerRank` with `/admin/team-rankings` via `src/lib/rating/powerRankings.ts`
(extracted from `admin/team-rankings/page.tsx`, which previously defined these as
unexported module-local helpers — pure extraction, no behavior change to the admin
page). Public queries deliberately never `include` `Club.contacts` (real PII —
name/email/phone/title) even though the admin queries being mirrored don't either;
called out explicitly since a future edit to either page's `club` include should keep
it that way.

**Nav consolidation (post-Phase-5, UI-only).** Per user direction, `/admin/rankings`,
`/admin/power-rankings`, and their `[seasonId]/[ageGroup]` detail routes were all
removed and fully inlined into a single page, `/admin/team-rankings` — no more
separate index-page-then-detail-page navigation for either ranking. The page is
query-param-driven (`?season=&view=&ageGroup=`) rather than path-segment-driven:
a season `<select>` (auto-submitting via a small client component,
`SeasonFilterSelect.tsx` — the one bit of client-side JS on this page, mirroring the
existing `RegionFilterSelect.tsx` pattern from `/admin/clubs`), a "NPS Rankings" /
"Power Rankings" view-selector tab row, and a 12u–18u age-group tab row (both tab rows
are plain `<Link>`s carrying the other two params forward, not client state) drive
which table renders below — `NpsRankingTable` or `PowerRankingTable`, two server
components in the same file. The three separate Colley/Elo/Massey recompute buttons
were also collapsed into one "Recompute ratings" button/server action that runs all
three sequentially for the selected season. "NPS Rankings" is purely a display label
on the existing points-based `totalPoints`/`rank` ranking, not a switch to the
`RankingResult.npsRank`/`npsPoints` columns described in §1.4 (those remain
unpopulated, waiting on Phase 4/5 calibration) — worth knowing if a future session
sees "NPS Rankings" in the UI and goes looking for where `npsRank` is read from.

**"Combined Rankings" view (post-Phase-5, UI-only; renamed from "Combine Rankings"
2026-07-29).** `/admin/team-rankings` gained a third view tab alongside NPS/Power:
"Combined Rankings," a single blended ranking for staff who want one number rather
than reading NPS and Power side by side. Two additive pieces:
- **Power Rankings gained an "Avg Rank" column** — `averagePowerRank()` averages a
  team's *rank* (not raw rating) across whichever of Colley/Elo/Massey actually rated
  it, since the three engines' raw ratings live on incompatible scales (Colley ~0.7–1.3,
  Elo ~1500–2000, Massey ~±30) and averaging them directly would just be dominated by
  whichever engine produces the largest numbers — rank-averaging is the same technique
  used to combine separate sports polls into one composite. A team not rated by an
  engine isn't penalized with a worst-case fill-in; it's just excluded from that
  average. Power Rankings' default (unsorted) row order changed from the old
  Colley-then-Elo-only-then-Massey-only stacking to Avg Rank ascending, since the new
  column is meant to be the table's headline number.
- **New `CombineRankingTable`** blends NPS rank and Power's own Avg Rank 50/50 into a
  "Combined Score" — both inputs are already ranks, so a straight mean is meaningful
  the same way Avg Rank's own averaging is. A team missing one side of the blend (an
  NPS finish history but no imported matches yet, or vice versa) falls back to 100% the
  side it has rather than being penalized; a team with neither has no score and sorts
  last. Reuses `getLatestPowerRatings()`/`buildPowerRows()` (factored out of the
  existing `PowerRankingTable` for this purpose) rather than a second, independent copy
  of the three-engine queries — as of the public `/rankings` section (2026-07-30) these,
  plus `sortRows()`/`averagePowerRank()`/`ordinalSuffix()`, moved again into
  `src/lib/rating/powerRankings.ts` so the admin and public team-rankings pages share
  one implementation instead of two. (Function/component name kept as `CombineRankingTable`
  in code even after the user-facing tab label was renamed to "Combined Rankings" —
  purely a display-string change, not a rename pass through the codebase.)

This is presentation-only — no new persisted model, no change to `RankingResult` or
`TeamRatingHistory` — both `averagePowerRank()` and `combinedScore()` are computed
live from already-persisted per-engine ratings, the same pattern the Analysis page's
"Rating Weight" column already uses for a different live-computed number (see above).

**Ordinal Rank columns on Power and Combined Rankings (2026-07-29).** Both tables only
showed a raw computed number (Avg Rank / Combined Score) that staff had to interpret
themselves, unlike NPS Rankings' own persisted `rank` column. Both gained a leading
**Rank** column — position by that table's own headline metric (Avg Rank / Combined
Score ascending), computed once into a `teamId -> position` map so the number stays
fixed regardless of which column the table is currently sorted/displayed by (clicking
"Colley Rank" re-sorts row order but each row still shows its Avg-Rank-based position).
This is also how the plan's earlier "Power Rankings default/primary labeling" item
(see above) was resolved in practice: the blended Avg Rank became the de facto primary
ranking by getting a real rank position, not by demoting Colley/Elo/Massey's own
columns.

**Match Results grouped by event, team detail page (2026-07-29).**
`/admin/teams/[teamId]`'s Match Results section was a single flat, chronological list
of `<details>` rows; per user request (modeled on a competitor site's tournament-level
summary card), matches are now grouped by event, collapsible per event (auto-expanded
when a season has only one event). Each event group header shows the event
name/date-range/division(s), **Wins**/**Losses** badges, a total **Elo Δ** for that
event (omitted if none of its matches have Elo data yet), and match count. Inside a
group, matches are listed chronologically (day-1-morning to day-2-afternoon, not
newest-first) with a new **Set Scores** column — the actual per-set point scores
(`Match.setScores`, already imported but previously only shown as a set *count*),
reoriented from AES's stored `{a, b}` = teamA/teamB into "this team vs. opponent" via a
new `thisTeamIsA` flag alongside the existing `opponent`/`wonByThisTeam` normalization.
Each match row is still individually expandable for the existing "why your Elo
changed" panel. A season-level **Total / Wins / Losses** summary line (matching a
second UI reference from the same competitor site) was added directly under the
"Match Results" heading, above the per-event list.

**Girls-only ranking filter, all engines (2026-07-29).** Per explicit user direction,
boys teams are excluded from every ranking/rating computation — boys ranking support
is planned (`docs/domain-notes.md`/legacy scope) but not built, and until it is, boys
results shouldn't leak into the girls-focused output. New `src/lib/teamGender.ts`'s
`isBoysTeamCode()` checks a `TeamSeason.externalTeamCode`'s leading character (AES's
gender-prefix convention — "g"/"b", see `aesTeamCode.ts`); a missing/unparseable code
is treated as NOT boys (only positive evidence excludes — see the file's own comment).
Wired into the three finish-gathering filters that already existed for age-group/
ignoreAge resolution: `computeRanking.ts` (points-based NPS ranking),
`computeColleyRatings.ts`, and `computeEloRatings.ts`'s `getPartitionMatches()`
(shared by both Elo and Massey) — boys finishes are excluded *before* divisions/
comparisons/matches are even built, not just filtered from the final output, so a
boys-only division contributes nothing at all (the practical meaning of "ignore boys
divisions," since a mixed division just loses its boys teams under this same filter,
per the user's own definition of "boys division" = boys-only). Confirmed this is safe
math, not just filtering: Colley/Massey's matrices only have nonzero cross-team
entries for teams that actually played each other, and Elo only updates the two teams
in a given match, so an all-boys subgraph can't perturb girls' ratings numerically even
before exclusion — the fix is about correct output, not a hidden math dependency.
Verified against real dev-DB data: 104 boys `TeamSeason` rows existed pre-fix, 17 of
which had leaked into `RankingResult` and 2,776 stray rows into `TeamRatingHistory`
(cross-referenced by team ID after recompute, not name — some boys/girls teams
coincidentally share a display name, e.g. two different "CVC 14-1" teams). After
recompute, zero boys teams remain in NPS/Power/Combined Rankings.

**`TeamRatingHistory` weekEndingDate dedup fix (2026-07-29).** Found while verifying
the gender filter above: `computeColleyRatings`/`computeEloRatingsForPartition`/
`computeMasseyRatingsForPartition`'s delete-and-replace snapshot pattern
(`deleteMany` matching the exact `weekEndingDate` before inserting fresh rows) never
actually replaced anything in practice, because the `*ForSeason` entry points default
`weekEndingDate` to `new Date()` — millisecond-precise, so two recompute runs on the
same calendar day never produce an equal timestamp. Every "Recompute ratings" click
was silently just adding another permanent, never-cleaned snapshot on top of every
prior run from that day, rather than replacing the day's snapshot as the existing doc
comments already claimed. Reads were unaffected (every query takes the latest
`weekEndingDate`), but the table grew unbounded — confirmed 206,923 real rows in the
dev DB, almost all dead duplicates. Fix: new `src/lib/rating/weekEndingDate.ts`'s
`normalizeWeekEndingDate()` truncates to UTC midnight, applied inside all three
partition functions (not just at the `*ForSeason` default) so it's correct regardless
of caller. Verified two back-to-back same-day Colley recomputes now produce a 0-row
delta on the second run (previously +5,367). One-time cleanup of the existing backlog
(kept only the latest `weekEndingDate` per `(seasonId, ageGroup, ratingEngine)`, since
that's the only slice any read path ever queries) brought the dev DB from 206,923 down
to 16,101 rows, with Power Rankings verified to render identically before/after.

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
with chronological backfill ✅ done (see Status above). Massey batch least-squares
engine ✅ done, ridge-regularized, from the real per-set point scores already
captured by the Match import (see Status above). Power Rankings' default/primary view
resolved as the blended Avg Rank column, not a promotion of a single engine — see the
"Power Rankings default/primary labeling — resolved" entry in Status above. **Not
started**: a periodic/scheduled re-run of any of the three engines (today all are
manual-trigger buttons — waits on Phase 6's background-job infra). CPI activation was
scoped and then explicitly dropped — see the "CPI activation — dropped" entry in
Status above; future rating work here should be algorithm tuning/calibration, not new
composite-score columns.

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
13. **Club ranking (Phase 7, not yet built)** — methodology scoped from the legacy
    site; design questions the source page leaves unanswered are listed in §8. See §8
    for the full writeup.

---

## 8. Club Ranking (Phase 7 — methodology scoped, not built)

A club-level ranking, alongside the existing team-level (best-3-of-season points)
ranking. Per explicit user direction (2026-07-27), this carries forward the
**existing/legacy US Club Rankings methodology**
(https://www.usclubrankings.com/methodology.html) rather than a from-scratch design —
this section is that page's methodology as published, translated into this project's
terms, plus the gaps it leaves that need a decision before implementation.

**As published, the methodology is (with source ambiguities resolved by explicit user
decision on 2026-07-27 — see each point):**

1. **Eligibility**: a club qualifies for National Club Rankings only if it has "at
   least 3 teams in different age groups ranked in the top 100 of the National
   Rankings" — **top 100 is per age group** (13U/14U/.../18U each evaluated
   separately against the existing team-level `RankingResult`, not top 100 overall
   across all age groups combined — resolves the source page's ambiguity here).
   **Under-qualified clubs are still ranked, but demoted below the fully-qualified
   group**: a club with only 1 or 2 teams (instead of the required 3+) in different
   age groups' top 100 can still appear in the club rankings and still gets a score
   computed the normal way (§8.2-4), but is sorted after every club that does meet the
   3-teams-in-top-100 bar, regardless of raw score — i.e. this is a two-tier sort
   (qualified-by-count first, ordered by score; under-qualified second, ordered by
   score within that group), not a hard exclusion.
2. **Per-age-group raw score**: take the club's *highest-ranked team only* in each age
   division (not all of the club's teams in that age group) — that team's rank maps
   to points on a **strictly linear** descending scale, one point per rank, with no
   floor: 1st=100, 2nd=99, 3rd=98, 4th=97, 5th=96, 6th=95, 7th=94, ... i.e.
   `points = 101 - rank`. **Ties share the tied place's point value** — e.g. two teams
   tied for 5th both score 96, matching the existing competition-style tie handling
   already used for `TeamFinish`/`RankingResult` (§4).
3. **Age-group weighting**: raw points × weight. **Decision: use the 2025 weighting
   — all six age groups (13U through 18U) weighted equally at 20%** — not the 2024
   scheme, and not built as a season-versioned/admin-editable config for now (the
   site's own 2024→2025 change is historical context, not a requirement to support
   arbitrary future weight sets from day one).
4. **Final club score**: sum the weighted per-age-group scores, but **drop the club's
   lowest of the six age-group scores** before summing — i.e. best-5-of-6, the
   club-level analog of the existing team-level best-3-of-season rule (§4). This
   resolves the source page's "14's to 18's" phrasing: rather than hardcoding an
   exclusion of 13U, 13U is included in the pool of six and simply is (or isn't) the
   one that gets dropped, based on its actual score that season.

**Design implications for this codebase** (not yet built — sketch only):
- Needs a new `ClubRankingResult`-style materialized table (mirrors the existing
  `RankingResult`/`RankingResultContribution` pattern — recomputed on trigger, not
  per page view, and should similarly record which 5 of 6 age-group scores counted
  and which one was dropped, for the same "here's what didn't count" transparency
  `RankingResultContribution` gives at the team level), scoped per `(season)`. Needs a
  field capturing whether the club met the 3-teams-in-top-100 bar (e.g. `isQualified`),
  since rank order is qualified-clubs-by-score first, under-qualified-clubs-by-score
  second — not a single global score sort.
- No new age-group-weight config needed for v1 — 20%-flat is a fixed constant per the
  decision above, not a UI to build.
- Still depends on the not-yet-built club-alias/grouping mechanism (§7 item 13): a
  club that changed or holds multiple `Club.externalCode`s needs to be treated as one
  club for this rollup, or its teams' top finishes will be split across "different"
  clubs and undercount.
- The "highest-ranked team only per age group" rule means this is cheap to compute
  from data already in `RankingResult` — no new team-level computation needed, just a
  club-level rollup/aggregation over it, plus the linear-with-ties point mapping and
  the drop-lowest-of-6 step.
