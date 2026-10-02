# ADR 0001: Migrations via the Supabase CLI only, with rollbacks and probes

Status: accepted (CLI-only since the project started; rollbacks and probes
since 2026-09-26).

## Context

The database is the rule engine (612 migrations, 404 files defining
SECURITY DEFINER functions). Two Supabase projects (staging, production) must
stay in step, and the migration history table is the only record of what was
applied where. Applying SQL through a dashboard editor or an MCP tool leaves
no migration file and no history row, which has caused drift that then had
to be reconciled with `supabase migration repair`.

## Decision

1. Schema and function changes are made only as files in
   `supabase/migrations/` and applied with `supabase db push --linked` after
   `supabase db push --linked --dry-run --include-all`. No dashboard SQL
   editor, no MCP `apply_migration`.
2. Every migration since 2026-09-26 ships a rollback file in
   `supabase/rollbacks/<version>_<name>.down.sql` that restores the previous
   function bodies, policies and grants. Rolling back means applying that
   file as a new forward migration so history stays linear.
3. A security-relevant migration ships a probe in
   `supabase/tests/security/<name>.probe.sql` that switches identities with
   `SET LOCAL ROLE` and `request.jwt.claims`, prints PASS/FAIL lines and ends
   with a `RAISE` so it rolls itself back. Probes run on staging before merge
   and on production after the push.
4. CI validates the files against staging on every push and PR; on `main` it
   asserts that every migration file has already been applied to staging.

## Evidence

- `supabase/rollbacks/` holds 14 `.down.sql` files matching the 14 migrations
  from `20260926100000` to `20261002200000`.
- `supabase/tests/security/` holds 16 probes; headers state they run on
  staging only and roll back.
- `.github/workflows/ci.yml`, job "Migration Validation".
- Recent migration headers carry `Rollback: supabase/rollbacks/...`.
- Project memory records the `migration repair` reconciliation pattern and the
  rule against MCP `apply_migration`.

## Consequences

- Older migrations (598 of them) have no rollback file; forward fixes are the
  path for those.
- A rollback that touches data (not just definitions) still needs a plan;
  the `.down.sql` convention covers definitions.
- Nothing yet enforces that a new migration has a rollback file or a probe;
  see the audit report for the proposed CI check.
