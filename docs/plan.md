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
| 2 | CSV import pipeline (AES adapter first) | Not started |
| 3 | Tier 1 rating engine (Colley) + algorithmic scoring suggestion | Not started |
| 4 | Cross-season bootstrapping and calibration | Not started |
| 5 | Tier 2 upgrade (Elo + Massey from real match data) | Not started |
| 6 | Polish — flags, ballots, weight config, background jobs, hosting | Not started |

**Where things actually stand right now:** a fully working admin app for hand-operated
season management — create a season, clubs, teams (enrolled per-season via
`TeamSeason`), events, divisions, point templates, apply a curve to a division by hand
or from a template, enter team finishes, confirm scoring, and see the resulting
top-3-of-season ranking per age group, including the `ignoreAge` cross-age-group case.
Verified end-to-end against a real scenario (2026 Triple Crown NIT / 14 Open, scored
against the legacy 245/230/220/180 curve). No CSV import yet — all data entry is
manual. No algorithmic scoring yet — point curves are always picked/applied by a
human. `npm run db:seed-demo` rebuilds this walkthrough data from scratch.

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
  setScores (JSON), winnerTeamId. **Not populated until Phase 5** — modeled now so the
  schema doesn't need to change when match-level import lands, but inert until then.
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

### 1.5 Import / Audit — not built yet (Phase 2)
- ImportBatch — source (AES|SPORTWRENCH|TM2|VBSCHEDULE|MANUAL), importType
  (DIVISIONS|TEAM_FINISHES|MATCH_RESULTS), status, summaryJson. One ImportBatch spans
  multiple uploaded files (see §3.1 — AES's "_part1/_part2..." splitting).
- ImportFile — per-file record within a batch.
- ImportRow — staging rows for the preview screen (OK/WARNING/ERROR, matched
  team/club, confidence).
- AuditFlag — Team Finish Error/Flags audit (duplicate rank conflicts, unlinked teams,
  name mismatches, etc.).

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

## 3. CSV Import Pipeline (Phase 2 — not built)

**Pipeline stages**: Start batch (source + import type + target event) → attach
file(s) (multi-part support built in from the start — AES exports split past ~300
lines) → parse via source-specific adapter → resolve (exact lookup via structured code
for AES; fuzzy name-match fallback for sources without one) → preview (editable grid,
"new club code" staging) → commit (single transaction, creates new Clubs/Teams,
writes Division/TeamFinish rows) → post-commit audit (AuditFlag rows for ambiguity).

**AES adapter specifics** (confirmed against a real 2026 Triple Crown NIT sample):
decode the fixed-width team code into clubExternalCode/regionCode/ageGroup/teamNumber;
one AES file spans many age groups/divisions at once (grouped by an
`ageGroupLabel` column), not one file per division. A code that doesn't resolve to a
known Club is staged as "New Club Code" — admin names it once in the preview screen,
and every future import referencing that code resolves automatically (this **is** the
"separate import that maps code to club name" — implemented as the ordinary Club CRUD
screen with a resolve-new-codes entry point, not a separate mapping table).

**Manual/Generic adapter** ships alongside AES's: admin hand-picks which CSV column
maps to which canonical field. Permanent safety net, and the only path for
Sportwrench/TM2/VBSchedule until their real sample exports are reviewed.

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

Planned, not built: `/admin/events/[eventId]/divisions/[divisionId]/scoring`
(suggestion-review screen, Phase 3), `/admin/imports*` (Phase 2),
`/admin/teams/unlinked`, `/admin/teams/inactive`, `/admin/clubs/unlinked`,
`/admin/clubs/inactive` (Phase 2 audits), `/admin/flags` (Phase 6), `/admin/ballots`
(Phase 6), `/admin/power-rankings/[season]/[ageGroup]` (Phase 5),
`/admin/analysis/[season]/[ageGroup]` (Phase 3).

---

## 6. Phased Build Roadmap (detail)

**Phase 0 — Foundations.** ✅ Done. Repo scaffold, Prisma + local dev Postgres (via
`prisma dev`, no Docker), base schema, Auth.js credentials-based auth with a Pending
Users approval workflow, Edge-safe proxy gating `/admin/*`.

**Phase 1 — Manual parity core.** ✅ Done (see Status above). Event/Division CRUD,
PointTemplate CRUD + band editor, manual point-curve assignment, TeamFinish
entry/reorder, top-3-of-season ranking + Rankings view. Shippable v1 functional
parity, worked entirely by hand.

**Phase 2 — CSV import pipeline.** Not started. Multi-file-per-batch support; AES
adapter against the real sample format; Manual/Generic adapter; Sportwrench/TM2/
VBSchedule adapters once sample exports are reviewed; fuzzy team/club matching;
Unlinked/Inactive audits; ImportBatch history + preview/commit flow.

**Phase 3 — Tier 1 rating engine (Colley) + algorithmic scoring.** Not started. Fully
deliverable with data available today (placement-only), no dependency on new
scraping work. Analysis view first, then Colley batch solve, weekly
TeamRatingHistory snapshot + Power Rankings view, FSS computation + suggestion
generation, Division scoring-review screen, DivisionScoringSnapshot audit trail.

**Phase 4 — Cross-season bootstrapping and calibration.** Not started. Prior-season
carry-forward with regression-to-mean; calibrate FSS thresholds against real
historical data; confidence/warning banners; capture override-reason data.

**Phase 5 — Tier 2 upgrade (Elo + Massey).** Not started. Match Results import type
(AES first, reusing `aes-tourney-director`'s proven fetch pattern), incremental Elo
with chronological backfill, periodic Massey cross-check, CPI activation, Power
Rankings switches from Colley to Elo labeling.

**Phase 6 — Polish.** Not started. Team Finish Error/Flags workflow, Ballots stub,
ClubContacts, RankingWeightConfig UI, background-job infra for recompute/weekly jobs,
hosting finalization.

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
