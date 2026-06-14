-- ─────────────────────────────────────────────────────────────────────
-- Logged-out Community browse — grant anon the remaining community
-- columns (privacy-audited).
-- ─────────────────────────────────────────────────────────────────────
-- Product change: logged-out visitors can now browse the Community member
-- grid + featured carousel (every ACTION — save / message / friend / apply /
-- post — stays gated behind a sign-in prompt in the app layer).
--
-- The anon row policy ("Anon can view active onboarded profiles":
-- onboarding_completed = TRUE AND is_test_account = false) already exposes the
-- whole community at the row level. The gap was purely COLUMN-level. Verified
-- live as the `anon` role that BOTH consumers — the PeopleListView grid fetch
-- (direct PostgREST SELECT) and get_top_community_members (SECURITY INVOKER,
-- so the anon caller's column grants apply) — succeed once these four columns
-- are granted; the JOIN reference tables (world_clubs / world_leagues), brands,
-- the RPC EXECUTE grant, and every other projected column were already in place.
--
--   * open_to_opportunities — broad availability flag. Read by BOTH consumers.
--     Community-safe: a POSITIVE availability signal already surfaced publicly
--     as a role label ("Open to partnerships" / "Recruiting" / etc.).
--
--   * is_blocked — read ONLY in get_top_community_members's WHERE clause to
--     HIDE moderated profiles. The function is SECURITY INVOKER, so anon must
--     read the column to evaluate the filter. Non-sensitive boolean; blocked
--     rows are filtered OUT and never returned.
--
--   * created_at, profile_completeness_pct — community sort keys, both
--     projected by the grid fetch + the RPC. These were ORIGINALLY granted to
--     anon by 20260522120000_grant_anon_select_profiles_community_columns.sql,
--     but 20260528110000_explicit_data_api_grants.sql ran
--     `REVOKE SELECT ON public.profiles FROM anon`, which (per Postgres
--     semantics) wipes column-level grants too. The follow-up restore
--     (20260528120000) only re-added the ORIGINAL allow-list and missed these
--     two — so they have been silently absent from anon since. Restoring them
--     here. Both are non-sensitive (a timestamp + an integer percentage) and
--     were anon-readable by design before the regression.
--
-- `authenticated` already holds all four grants. GRANT is idempotent, so
-- re-running is a no-op (these were applied live to staging out-of-band; this
-- file formalises the same change for prod via `db push`).

BEGIN;

GRANT SELECT (
  open_to_opportunities,
  is_blocked,
  created_at,
  profile_completeness_pct
) ON public.profiles TO anon;

COMMIT;
