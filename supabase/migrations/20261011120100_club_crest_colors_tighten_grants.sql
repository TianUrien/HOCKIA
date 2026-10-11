-- Tighten club_crest_colors grants (follow-up to 20261011120000).
-- Rollback: supabase/rollbacks/20261011120100_club_crest_colors_tighten_grants.down.sql
-- Probe:    supabase/tests/security/club_crest_colors_acl.probe.sql (read-only)
--
-- The project's default privileges gave anon and authenticated ALL on the new
-- table; REVOKE ... FROM PUBLIC does not touch those role grants. RLS already
-- refused the writes (no anon write policy, no DELETE policy at all), but the
-- grants now match the intent: anon reads; authenticated reads, inserts and
-- updates (own row, by RLS); nobody but the service role deletes.

REVOKE ALL ON public.club_crest_colors FROM anon, authenticated;
GRANT SELECT ON public.club_crest_colors TO anon;
GRANT SELECT, INSERT, UPDATE ON public.club_crest_colors TO authenticated;
