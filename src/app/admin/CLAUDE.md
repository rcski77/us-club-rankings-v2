# Admin UI — Conventions

Everything under `/admin` is gated by route-level middleware (`../../proxy.ts` — see
the note on that filename below) plus this directory's own `layout.tsx`, which
redirects anything that isn't an `ACTIVE`-status session to `/login`. Full route list
and what's built vs. planned: [`../../../docs/plan.md`](../../../docs/plan.md) §5.

## Page structure pattern

Two shapes, used consistently:

- **List + create, one page** (`seasons/page.tsx`, `clubs/page.tsx`, `teams/page.tsx`,
  `point-templates/page.tsx`, `regions/page.tsx`): a table of existing records, then an
  inline create form below it, both server-rendered on the same route. The create
  form's action is either inline in the page file (`async function createX(formData)
  { "use server"; ... }`) for simple single-entity creates, or imported from a
  sibling `actions.ts` when a route needs several related mutations (see
  `events/[eventId]/divisions/[divisionId]/actions.ts` — that page has apply-template,
  add/remove-band, confirm/unlock, add/remove/update-finish, all as separate exported
  server actions).
- **Detail + edit, `[id]/page.tsx`**: shows the record, an edit form pre-filled with
  `defaultValue={record.field}`, and any related child data (e.g.
  `teams/[teamId]/page.tsx` shows season enrollments and finish history below the edit
  form). Linked to from the parent list page by making the name column a `<Link>`.

When a detail page needs its own multi-step workflow (not just edit-and-save) — see
`events/[eventId]/divisions/[divisionId]/`, which has DRAFT/CONFIRMED-gated UI (band
editing and finish entry are only editable pre-confirm) — split mutations into a
sibling `actions.ts` rather than piling more inline `"use server"` closures into the
page component.

## Error handling: redirect + query param, not thrown exceptions

Server actions validate, and on failure `redirect()` back to the same page with
`?error=<code>`; the page component reads `searchParams`, and renders a banner
(`errorBannerClass` from `../../lib/ui.ts`) keyed off that code. Example from
`clubs/page.tsx`:

```ts
if (!name) redirect("/admin/clubs?error=invalid");
// ...
{error === "invalid" && <p className={errorBannerClass}>Club name is required.</p>}
```

Don't `throw` validation errors expecting Next.js's error boundary to show something
useful to the user — it won't be a helpful message. Follow the existing pattern.

## Shared UI primitives

`../../lib/ui.ts` exports Tailwind class-string constants (`inputClass`,
`selectClass`, `primaryButtonClass`, `secondaryButtonClass`,
`smallSecondaryButtonClass`, `errorBannerClass`, `tableClass`, `thClass`, `tdClass`).
Always reuse these on new pages instead of inlining classes — it's what keeps every
admin page visually consistent without a component library.

**Tables spanning grouped sections** (e.g. Regions grouped by zone) should be **one
`<table>`** with a full-width label row between groups (`<td colSpan={n}>`), not
separate `<table>` elements per group — independent tables each auto-size their own
columns, so columns won't line up across groups. See `regions/page.tsx` for the
pattern (and the bug it fixes).

## Data fetching: sequential, not `Promise.all`

Every page that fetches multiple things awaits them one at a time. This is not a style
preference — the local dev Postgres reliably drops connections under concurrent
queries from the same pool. See
[`../../../docs/dev-environment.md`](../../../docs/dev-environment.md). Keep doing
this for new pages until that doc says otherwise (e.g. once running against a real
persistent Postgres).

## Auth / session shape

`session.user` (from `../../auth.ts` / `../../auth.config.ts`) has `id`, `email`,
`role` (`SUPER_ADMIN | ADMIN | PENDING`), `status` (`PENDING | ACTIVE | DISABLED`)
baked into the JWT at login — no DB lookup needed to check role/status in a page or
action. `layout.tsx` gates on `status === "ACTIVE"`; individual pages/actions that need
`SUPER_ADMIN` (currently just `users/page.tsx`) check `session.user.role` directly.

## Naming/slug generation

`../../lib/slug.ts`'s `uniqueSlug(base, existsCheck)` — slugifies a name and appends
`-2`, `-3`, ... until `existsCheck` reports the candidate is free. Used for Club/Event/
Division slugs at creation time; call sites pass a Prisma existence check as the
callback (see `events/new/page.tsx`).

## Note on `proxy.ts`

Next.js 16 renamed the `middleware.ts` file convention to `proxy.ts` (deprecation:
"the term middleware is often confused with Express.js middleware"). This project's
`src/proxy.ts` is that file — if you're looking for route-gating logic and don't find
a `middleware.ts`, that's why. It's intentionally Edge-safe (no Prisma import) — see
its top comment and `src/auth.config.ts` (the Prisma-free base auth config it uses).
