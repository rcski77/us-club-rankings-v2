# Local Dev Environment

## Running the app

```bash
npm install
npm run db:up           # starts Postgres in Docker, see below
npm run db:push          # sync schema
npm run db:seed          # bootstrap SUPER_ADMIN account
npm run db:seed-regions  # 40 USAV regions
npm run db:seed-demo     # optional: sample walkthrough data (club/teams/event/rankings)
npm run dev
```

Bootstrap admin login: email/password come from `SEED_ADMIN_EMAIL`/
`SEED_ADMIN_PASSWORD` in `.env` (not committed — see `.env` locally for the actual
dev values). Change the password after first login in a real deployment; for local
dev it doesn't matter.

## Local Postgres via Docker

This project runs local Postgres through Docker Desktop (`docker-compose.yml` at the
repo root — a single `postgres:16` service named `us-club-rankings-v2-db`, port 5432,
with a named volume so data survives container restarts). `.env`'s `DATABASE_URL`
points at it (`postgres://postgres:postgres@localhost:5432/us_club_rankings_dev`).

```bash
npm run db:up      # docker compose up -d postgres
npm run db:down    # docker compose down (container stops; volume/data persists)
```

To wipe the database entirely (fresh start), also remove the volume:

```bash
docker compose down -v
npm run db:up
npm run db:push
npm run db:seed
npm run db:seed-regions
npm run db:seed-demo    # if you want the sample data back
```

This project previously used Prisma 7's built-in `npx prisma dev` ephemeral server
instead of Docker, since Docker Desktop wasn't reliably available in the original dev
environment. That server had real instability (`P1017 Server has closed the
connection` after long sessions, and unreliable behavior under concurrent queries —
see below) and couldn't run `prisma migrate dev` at all, since its shadow-database
connection consistently failed with `P1017` even when the main connection was fine.
Docker Desktop is now available, so the project moved to a real standalone Postgres
container, which doesn't have either problem.

**Schema changes still use `db push`, not `migrate dev`, for now** — this project has
no migration history yet (`prisma/migrations/` isn't part of the current workflow).
Real Postgres can now run `prisma migrate dev` reliably (it auto-manages its own
shadow database), so this is a viable point to switch to real migrations and generate
an initial one from the current schema — that hasn't been done yet, so keep using
`npx prisma db push` for schema changes until it is.

**Prisma 7's client generator needs a driver adapter.** Unlike the older
`prisma-client-js` generator, the `prisma-client` generator this project uses doesn't
read `DATABASE_URL` automatically — every `PrismaClient` construction needs an
explicit adapter:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
```

`src/lib/prisma.ts` is the shared singleton for the app itself (Next.js hot-reload
safe via a `globalThis` cache); one-off scripts under `prisma/*.ts` construct their
own client the same way (see `prisma/seed.ts`, `seedRegions.ts`, `seedDemo.ts`).

**Concurrent queries — sequential `await` convention, inherited from the old
Prisma-dev database.** Every admin page in this codebase fetches multiple things with
sequential `await` calls, not `Promise.all`, because the previous `npx prisma dev`
database (whatever it was backed by under the hood — likely a lightweight/embedded
engine, not full standalone Postgres) reliably threw `Connection terminated
unexpectedly` under concurrent queries from the same connection pool. Now that the
project runs against a real Postgres container, this constraint likely no longer
applies, but it hasn't been re-tested or the existing pages converted back to
`Promise.all`. Keep writing new pages with sequential `await` to match the existing
codebase until someone deliberately verifies concurrent queries are safe here and
updates this convention project-wide.

## Regenerating the Prisma client after a schema change

The running `next dev` process caches the generated client at startup. After
`npm run db:push` following a schema change, also run `npx prisma generate`, then
**restart the dev server** (a schema change alone won't hot-reload into a already-running
process — you'll see errors like `Cannot read properties of undefined (reading
'findUnique')` if you forget this, since the running process is still holding the
pre-change client).

## Seed scripts reference

| Script | Command | What it does |
|---|---|---|
| `prisma/seed.ts` | `npm run db:seed` | Creates one bootstrap `SUPER_ADMIN` user from `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`. Idempotent (skips if that email exists). |
| `prisma/seedRegions.ts` | `npm run db:seed-regions` | Upserts all 40 USAV regions (name, code, zone). Safe to re-run. |
| `prisma/seedDemo.ts` | `npm run db:seed-demo` | Rebuilds the sample walkthrough: one club (MadFrog Volleyball), four teams (one `ignoreAge` playing up), one anchor event (2026 Triple Crown NIT) with a confirmed 14 Open division scored against the legacy 245/230/220/180 curve, and the resulting 14u/13u rankings. Idempotent (upserts by natural keys) — safe to re-run after a database reset. Requires regions to be seeded first (looks up the "NT" region). |

## Browser preview

Use the `preview_start`/`preview_stop` tools with the `us-club-rankings-v2` launch
config in `.claude/launch.json` (runs `npm run dev` on port 3000) — don't run `next
dev` directly via Bash for interactive testing, since the preview tool manages the
tab/session.
