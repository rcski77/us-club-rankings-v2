# Prisma — Schema & Seeding Conventions

See also: [`../docs/dev-environment.md`](../docs/dev-environment.md) for the local
Postgres setup/troubleshooting this all runs against, and
[`../docs/plan.md`](../docs/plan.md) §1 for the original schema design and how it's
evolved.

## Schema design patterns used throughout

- **Frozen-copy pattern for scoring data**: `DivisionPointBand` is a copy of whichever
  `PointTemplate`'s bands were applied to a division, not a live FK to the template.
  This is deliberate — once a division is confirmed, its scoring must stay stable even
  if someone edits the source template later. Apply this pattern to any future
  "template applied to an instance" relationship rather than defaulting to a live FK.
- **State machine on the entity, audit trail in a separate table**: `Division.
  scoringStatus` (DRAFT|SUGGESTED|CONFIRMED) is the coarse, queryable state; the
  planned `DivisionScoringSnapshot` (Phase 3, not built yet) is where the fine-grained
  history/audit trail goes. Don't try to reconstruct history from the coarse field.
- **Compound natural keys over surrogate uniqueness where the domain requires it**:
  `Club` is unique on `(externalCode, regionId)`, not `externalCode` alone — confirmed
  from real data that a 5-char AES club code isn't globally unique (see
  `../docs/domain-notes.md`). Don't "simplify" this to a single unique column.
- **Season-independent persistent identity + a per-season join table**, not a
  season-scoped entity: `Team` (persistent: name, club) + `TeamSeason` (per-season:
  ageGroup, teamNumber, externalTeamCode). This replaced an earlier design where `Team`
  had a required `seasonId` directly — reworked after direct user feedback that a team
  should belong to multiple seasons, not get duplicated per season. **If you're adding
  a new season-varying fact about a team, it goes on `TeamSeason`, not `Team`.**
  Wherever ranking logic needs "this team's age group," look it up via `TeamSeason`
  for the season in question (`computeRanking.ts` does this correctly — copy that
  pattern, don't reach for a nonexistent `Team.ageGroup`).
- **Nullable FK = "unlinked/unresolved," not absence of the concept**: `Team.clubId`
  and `Club.regionId` are nullable specifically to represent "not yet resolved to a
  known record" (an import-pipeline concept — see `../docs/plan.md` §3) rather than
  "this team genuinely has no club." Postgres allows multiple `NULL`s in a unique
  index, which several unique constraints here rely on (e.g. `TeamFinish`'s
  `(divisionId, teamId)` doesn't need special-casing for unlinked teams).

## Generator

`generator client { provider = "prisma-client" }` — Prisma 7's newer client generator,
**not** the classic `prisma-client-js`. It does not auto-read `DATABASE_URL`; every
`PrismaClient` needs an explicit `@prisma/adapter-pg` adapter passed in. See
`../src/lib/prisma.ts` for the app's shared singleton pattern, and any `prisma/*.ts`
script for the one-off-script pattern (construct a fresh client, same adapter setup).

## Making schema changes

```bash
# edit prisma/schema.prisma
npx prisma db push       # NOT migrate dev — see ../docs/dev-environment.md for why
npx prisma generate
# restart the Next.js dev server — it caches the generated client at startup
```

No real migration history exists yet (`prisma/migrations/` isn't part of this
project's workflow currently) — `db push` diffs the schema straight onto the dev
database. When this project moves to a persistent Postgres, that's the point to
switch to `prisma migrate dev` and generate a real initial migration.

## Seed scripts

Three scripts, run in this order on a fresh database (`npm run db:seed*` — see
`../docs/dev-environment.md` for the full command reference):

1. `seed.ts` — bootstrap `SUPER_ADMIN` user (there's no admin yet to approve the first
   one, so this creates one directly from `.env`).
2. `seedRegions.ts` — all 40 USAV regions with zone groupings, upserted (safe to
   re-run, e.g. after adding a `zone` field).
3. `seedDemo.ts` — rebuilds a full sample walkthrough (club, teams, event, division,
   confirmed scoring, computed rankings) via upserts, so it's safe to re-run after a
   database reset. It calls the real `computeRanking()` from `../src/lib/ranking/`
   rather than reimplementing ranking logic, specifically so the seeded data stays
   correct if that function's logic changes.

When adding a new seed script, follow `seedDemo.ts`'s pattern: upsert on natural keys
so it's idempotent, and reuse real app logic (don't hand-roll a parallel
implementation of something `src/lib` already does correctly).
