# Local Dev Environment

## Running the app

```bash
npm install
npx prisma dev --name us-club-rankings-v2 --detach   # starts local Postgres, see below
npm run db:push        # sync schema (see "migrate dev is broken" below)
npm run db:seed        # bootstrap SUPER_ADMIN account
npm run db:seed-regions  # 40 USAV regions
npm run db:seed-demo   # optional: sample walkthrough data (club/teams/event/rankings)
npm run dev
```

Bootstrap admin login: email/password come from `SEED_ADMIN_EMAIL`/
`SEED_ADMIN_PASSWORD` in `.env` (not committed — see `.env` locally for the actual
dev values). Change the password after first login in a real deployment; for local
dev it doesn't matter.

## Local Postgres via `prisma dev` — no Docker needed

This project uses Prisma 7's built-in local dev Postgres server
(`npx prisma dev`) instead of Docker, since Docker Desktop wasn't reliably available
in the original dev environment. It's an ephemeral server tied to a name
(`us-club-rankings-v2`); `.env`'s `DATABASE_URL`/`SHADOW_DATABASE_URL` point at it.

**Known instability — read this before assuming the app is broken.** Over a long
session (many hours, several schema pushes and server restarts), this local dev
Postgres has crashed at least once: `npx prisma dev ls` kept reporting the server as
"running," but its actual TCP listener stopped responding, and every query — even a
single one from a freshly-created client — failed with `P1017 Server has closed the
connection` / `DriverAdapterError: ConnectionClosed`. If the app throws that error (or
"Connection terminated unexpectedly") and a plain server restart doesn't fix it, the
underlying database itself has likely died. Recovery:

```bash
npx prisma dev stop us-club-rankings-v2
npx prisma dev rm us-club-rankings-v2      # clears a stale lock if `stop` alone fails
npx prisma dev --name us-club-rankings-v2 --detach
npm run db:push
npm run db:seed
npm run db:seed-regions
npm run db:seed-demo    # if you want the sample data back
```

This wipes all data (it's a fresh database) — hence the seed scripts existing as
one-command rebuilds rather than needing to reconstruct anything by hand.

**`migrate dev` doesn't work against this server.** It needs a shadow database to diff
against, and that consistently fails with `P1017` even though the main connection is
fine. Use `npx prisma db push` for schema changes during active development instead —
it works reliably. This means there's no real migration history yet; if/when this
project moves to a persistent Postgres (Docker, or a hosted provider), that's the
right time to start using `prisma migrate dev` for real and generate an initial
migration from the current schema.

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

**Concurrent queries are unreliable — always await sequentially.** This local
Postgres (whatever it's backed by under the hood — likely a lightweight/embedded
engine, not full standalone Postgres) reliably throws `Connection terminated
unexpectedly` when two Prisma queries are issued concurrently from the same
connection pool (e.g. `Promise.all([prisma.a.findMany(), prisma.b.findMany()])`), even
when the server is otherwise healthy. Every admin page in this codebase fetches
multiple things with **sequential `await` calls**, not `Promise.all`, specifically
because of this. Keep doing that for new pages — it's a real, reproducible constraint
of this dev database, not a stylistic preference. Worth re-testing once the app runs
against a real persistent Postgres; this may not apply there.

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
