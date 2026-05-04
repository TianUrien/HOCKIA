-- =========================================================================
-- user_pulse_items — lock UPDATE to the lifecycle RPCs only
-- =========================================================================
-- The 1B.1 foundation migration created `user_pulse_items_update_self`,
-- which let owners update ANY column on their own pulse rows — including
-- `item_type`, `metadata`, `priority`, and `created_at`. The lifecycle
-- RPCs (mark_pulse_seen/clicked/dismissed/action_completed) are the only
-- intended write path; the policy was left in as defence in depth and
-- the migration's own comment acknowledged it as overly permissive.
--
-- Closing it here so a malicious frontend can't:
--   await supabase.from('user_pulse_items').update({ item_type: 'fake' })
--
-- The four lifecycle RPCs are SECURITY DEFINER and continue to function
-- because DEFINER bypasses RLS entirely. Direct writes via PostgREST are
-- now refused.
-- =========================================================================

DROP POLICY IF EXISTS user_pulse_items_update_self ON public.user_pulse_items;

REVOKE UPDATE ON public.user_pulse_items FROM authenticated;
