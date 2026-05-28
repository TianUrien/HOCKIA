# HOCKIA — agent working notes

## Pre-push validation

Before pushing anything that touches the client (`client/src/**`), run
the full validation pipeline:

```sh
cd client && npm run test:all
```

This runs `lint → typecheck → test:unit → build → test:e2e:smoke`.
The smoke suite is ~52s and catches UI regressions that unit tests
miss (e.g. testid changes, route mounts, auth gates).

**Do not substitute `tsc --noEmit` for `npm run typecheck`.** The
typecheck script uses `tsc -b --noEmit` (project-references mode),
which catches overload mismatches and shape errors that the simple
`tsc --noEmit` does not. CI runs the strict version, so locally cutting
the corner means CI failures land on the user after merge.

For pure backend / migration / docs changes, `npm run lint && npm run
typecheck && npm run test:unit` is enough — skip the e2e smoke pass.

## Staging-first deploys

The project's deploy convention is `staging` first, then `main`. Recent
commits land directly on `staging` (no feature branch). After the user
verifies on staging, the user merges `staging → main` themselves —
do **not** push to `main` without explicit instruction.

## Repo layout

- `client/` — Vite + React + Capacitor app (the SPA + iOS shell)
- `supabase/migrations/` — schema + RPC sources of truth
- `client/e2e/` — Playwright smoke + role-scoped specs
- `client/src/__tests__/` — Vitest unit tests

## Data API GRANTs on new tables

From Oct 30 2026 Supabase stops auto-exposing new public tables to the
Data API. `supabase/migrations/20260528110000_explicit_data_api_grants.sql`
installs `ALTER DEFAULT PRIVILEGES` for the postgres role so new
`CREATE TABLE public.*` migrations inherit the standard grants
(anon/authenticated CRUD + service_role ALL) automatically.

For exceptions:
- **Service-role-only table** (queues, scheduler state, etc.): add
  `REVOKE ALL ON TABLE public.<x> FROM anon, authenticated;` after
  the CREATE TABLE.
- **Tighter than CRUD** (e.g. SELECT-only for one role): explicit
  REVOKE for the disallowed verbs.

RLS is still the actual gate on every public table — the GRANTs are
the outer fence.
