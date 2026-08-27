-- Harden the two SECURITY DEFINER views flagged by the Supabase security
-- advisor (security_definer_view, ERROR level), audit 2026-08-27.
--
-- 1. public.profiles_self
--    A self-scoped read view (WHERE id = auth.uid()) that deliberately runs
--    as its owner so the signed-in member can read their own privileged
--    columns (email, date_of_birth) after the base-table column grants were
--    hardened for anon. It was ALSO granted INSERT/UPDATE/DELETE to
--    `authenticated`. Because a simple single-table view is auto-updatable
--    and a DEFINER view executes with the owner's (postgres) privileges, an
--    UPDATE through it bypasses the column-level UPDATE whitelist on
--    public.profiles — a member could set is_verified, is_blocked,
--    frozen_minor_at, org_attested_18plus_at, is_test_account … on their own
--    row, or DELETE it, with nothing but their JWT. The client only ever
--    SELECTs from this view (src/lib/auth.ts). Make it read-only.
--
-- 2. public.analytics_events
--    A DEFINER view over public.events (which itself is RLS-fenced to
--    platform admins) that was granted SELECT/INSERT/UPDATE/DELETE to
--    `authenticated`. Verified live: ANY signed-in member could read all
--    32k events (user_id, ip_hash, user_agent, properties, error messages).
--    No client code and no SQL function reads this view; the founder
--    dashboard reads public.events under its admin RLS policy. Remove all
--    end-user access; postgres / service_role keep theirs.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.profiles_self FROM authenticated, anon;

REVOKE ALL ON public.analytics_events FROM authenticated, anon;

-- Belt and braces: the events base table is what admins query; keep it
-- readable only through its RLS policy (already the case) and make sure the
-- view can never be reached by PostgREST callers again even if the grant is
-- re-added by a future CREATE OR REPLACE VIEW (which preserves grants).
ALTER VIEW public.analytics_events SET (security_invoker = true);
