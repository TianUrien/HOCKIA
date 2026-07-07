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

## Native bundles pin OLD clients — gate breaking API changes on them

Capacitor bundles the SPA **inside the native binary**: installed iOS/
Android apps keep running their build's JS until a store release ships.
"Deploy the web client first" is NOT enough for a breaking server-side
change (grant revokes, removed columns/RPCs, changed response shapes) —
the P0 on 2026-07-07 (DOB revoke → every native user's profile fetch
42501 → onboarding loop) happened exactly this way. Before any
API-breaking change: confirm the OLDEST client still in the field
(app_version_requirements.min_version) tolerates it, or raise
min_version + wait for adoption first.

## The hidden-profile predicate is NOT inherited — apply it explicitly

Profiles can be hidden (admin ban `is_blocked` OR frozen minor
`frozen_minor_at`; see `public.profile_is_hidden` /
`profile_is_uncontactable`). Base RLS enforces this ONLY for direct
table reads as anon/authenticated. **SECURITY DEFINER functions and
service-role reads bypass RLS entirely** — the 2026-07 integration audit
found 8 surfaces that leaked this way.

Standing invariant: **every new RPC, view, or service-role/edge-fn read
that returns people or their content must apply the hidden predicate
itself** (`AND NOT public.profile_is_hidden(p.is_blocked,
p.frozen_minor_at)`; use `profile_is_uncontactable(...)` for
discovery/contact surfaces). When fencing a surface that also COUNTS
people (digests, "N viewed you"), exclude hidden rows from the count
too — never a list/count mismatch.

## profiles uses COLUMN-LEVEL SELECT grants (age-gate, Jul 2026)

`date_of_birth` is owner/admin/server-only: both `anon` AND
`authenticated` hold **column-level** SELECT grants on `public.profiles`
(migration `20260707180000_age_gate_dob_revoke.sql`). Consequences:

- **Every `ALTER TABLE public.profiles ADD COLUMN` MUST ship with an
  explicit `GRANT SELECT (new_col) ON public.profiles TO authenticated;`**
  (plus `anon` if the column is public). PostgREST `select=*` is literal —
  one ungranted column breaks every `select('*')` on profiles app-wide.
- Never "fix" DOB access by re-granting: owners read their own row via the
  `profiles_self` view; visitors get server-computed age via
  `get_profile_ages`. Also beware: a column REVOKE is a silent no-op
  against a table-level grant — check `information_schema.column_privileges`
  when auditing.

RLS is still the actual gate on every public table — the GRANTs are
the outer fence.
