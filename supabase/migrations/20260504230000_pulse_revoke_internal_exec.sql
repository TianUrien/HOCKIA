-- =========================================================================
-- Pulse — revoke PUBLIC EXECUTE on internal helper + trigger functions
-- =========================================================================
-- The 1B.3 migration left `_maybe_insert_snapshot_gain_celebration` (and the
-- four `celebrate_*` trigger functions) callable by the default PUBLIC role
-- because Postgres GRANTs EXECUTE to PUBLIC by default and the underscore
-- prefix is purely a naming convention — PostgREST exposes the function over
-- the REST API regardless. Any authenticated client could call:
--
--   SELECT public._maybe_insert_snapshot_gain_celebration(
--     '<another-user-id>'::uuid,
--     'first_reference',
--     '{"endorser_name": "Pwned"}'::jsonb
--   );
--
-- Because the function is SECURITY DEFINER, the INSERT bypasses RLS and
-- writes a celebration card into the target user's Pulse feed. The 7-day
-- frequency cap throttles the abuse to one fake card per target per week,
-- but it's still a cross-user write hazard. Closing it here.
--
-- Triggers can only be invoked via the table event in normal operation;
-- revoking from PUBLIC is hygiene rather than enforcement.
-- =========================================================================

REVOKE EXECUTE ON FUNCTION public._maybe_insert_snapshot_gain_celebration(UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.celebrate_first_reference() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.celebrate_first_highlight_video() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.celebrate_first_career_entry() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.celebrate_first_world_club_link() FROM PUBLIC;
