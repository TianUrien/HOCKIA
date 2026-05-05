-- =========================================================================
-- HARDENING — REVOKE EXECUTE on internal Pulse helpers from anon + authenticated
-- =========================================================================
-- Discovered during the Loop MVP QA pass: the prior REVOKE migration
-- (20260504230000_pulse_revoke_internal_exec.sql) only revoked from
-- PUBLIC. Supabase auto-GRANTs EXECUTE to anon + authenticated on every
-- public function via default privileges, so the helpers were still
-- callable by any anon client over PostgREST.
--
-- Impact (now closed): an anon caller could:
--   - Call _maybe_insert_snapshot_gain_celebration(<any-user>, ...) →
--     inject fake celebration cards into another user's Pulse feed
--   - Call _insert_pulse_item(<any-user>, ...) → inject any item_type,
--     priority, metadata into another user's Pulse feed
--   - Call enqueue_availability_check_ins() / enqueue_profile_view_pulse_items()
--     → DoS / forced cron firing outside the schedule
--   - Call fire_friendship_reference_pulse() → no-op without trigger
--     context, but worth locking
--
-- Functions kept callable by authenticated:
--   - confirm_availability() — called by the check-in card. Uses
--     auth.uid() internally so the user can only confirm their own row.
--
-- Trigger functions and cron functions are SECURITY DEFINER so they
-- continue to run with full privileges when invoked by the trigger /
-- pg_cron itself; the REVOKE only blocks direct PostgREST calls.
-- =========================================================================

REVOKE EXECUTE ON FUNCTION public._insert_pulse_item(UUID, TEXT, SMALLINT, JSONB, INT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._maybe_insert_snapshot_gain_celebration(UUID, TEXT, JSONB) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.celebrate_first_reference() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.celebrate_first_highlight_video() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.celebrate_first_career_entry() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.celebrate_first_world_club_link() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fire_friendship_reference_pulse() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_availability_check_ins() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_profile_view_pulse_items() FROM anon, authenticated;
