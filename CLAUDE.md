@AGENTS.md

# US Club Rankings v2

Admin/back-office rebuild of a youth volleyball club-ranking platform: teams get
points from tournament finishes, a team's season ranking is its best-3-of-season point
total, and this app is where staff manage that whole pipeline. Full context — why this
rebuild exists, what's built vs. planned, and domain knowledge — lives in `docs/`:

- **[`docs/plan.md`](docs/plan.md)** — the phased implementation plan and current
  status. Read this first in a new session; it explains what's done, what's next, and
  where the design has deviated from the original plan.
- **[`docs/domain-notes.md`](docs/domain-notes.md)** — ranking methodology, the real
  AES CSV data format, USAV regions/zones, team identity across seasons.
- **[`docs/dev-environment.md`](docs/dev-environment.md)** — local Postgres-in-Docker
  setup, migration-workflow notes, seed scripts. Read this before assuming a
  connection error is an app bug.

Subdirectory conventions: [`prisma/CLAUDE.md`](prisma/CLAUDE.md) (schema/seeding),
[`src/app/admin/CLAUDE.md`](src/app/admin/CLAUDE.md) (admin UI patterns).

## Stack

Next.js 16 (App Router, Turbopack) + TypeScript + Tailwind + PostgreSQL + Prisma 7,
Auth.js (Credentials provider, JWT sessions). Local dev Postgres runs in Docker
(`docker-compose.yml`). Explicitly **not** using `prisma-client-js`'s auto-connect —
Prisma 7's newer `prisma-client` generator requires an explicit `@prisma/adapter-pg`
driver adapter everywhere a `PrismaClient` is constructed (see `src/lib/prisma.ts`).

## Scope

Admin/back-office only. The public-facing rankings website is explicitly out of scope
for this codebase (see `docs/plan.md`).

## Quick start

```bash
npm run db:up
npm run db:migrate && npm run db:seed && npm run db:seed-regions && npm run db:seed-demo
npm run dev
```

Full detail, troubleshooting, and the seed-script reference: `docs/dev-environment.md`.

## Git workflow

Always commit to a new branch, not directly to `master` — even for small changes.
Merge (and push, if asked) once the change is verified.

## Conventions worth knowing before editing

- **Sequential `await`, never `Promise.all`, for multiple Prisma queries in the same
  request.** Inherited from the old `npx prisma dev` database, which unreliably
  dropped connections under concurrent queries — now on Docker Postgres this likely
  no longer applies, but hasn't been re-verified/converted project-wide, so keep
  following the existing convention. See `docs/dev-environment.md`.
- **Shared style constants** in `src/lib/ui.ts` (`inputClass`, `tableClass`,
  `primaryButtonClass`, etc.) — reuse these rather than inlining Tailwind classes on
  new admin pages, for visual consistency.
- **Slugs**: `src/lib/slug.ts`'s `uniqueSlug()` helper — auto-generates a URL slug from
  a name and appends `-2`, `-3`, ... on collision. Used for Club/Event/Division slugs.
- **Error handling on admin forms**: server actions `redirect()` back to the same page
  with `?error=<code>`, and the page renders a banner keyed off that code — not thrown
  exceptions surfaced to the user. See any existing page (e.g.
  `src/app/admin/point-templates/page.tsx`) for the pattern.
- **After any Prisma schema change**: `npx prisma migrate dev --name <short_description>`
  (see `docs/dev-environment.md`), then `npx prisma generate`, then **restart the
  dev server** — the generated client is cached in the running process. Prod applies
  committed migrations automatically on redeploy via `docker-compose.prod.yml`'s
  `migrate` service (`prisma migrate deploy`) — don't hand-edit generated migration
  SQL after the fact.
- Don't add dark-mode styling reactively — `src/app/globals.css` intentionally forces
  light theme (a real bug: the Next.js default dark-mode media query made the admin
  sidebar unreadable against its light background). No dark theme has been designed;
  don't reintroduce `prefers-color-scheme: dark` without deliberately designing for it.
