-- Drop the orphaned admin_search_profiles overload
--   admin_search_profiles(text, text, text, boolean, boolean, integer, integer, text)
--   = (p_query, p_role, p_country, p_is_blocked, p_is_test, p_limit, p_offset, p_sort)
-- left behind by 202601281100_fix_admin_dashboard_table_refs.sql. The client
-- moved to the (… p_is_test_account, p_onboarding_completed …) shape in
-- 20260420230604 and never called this signature again — verified zero callers
-- (the only adminRpc('admin_search_profiles', …) site passes the new shape).
--
-- Two overloads of the same RPC is a latent PostgREST ambiguity risk; removing
-- the dead one leaves a single, unambiguous function. This does NOT affect the
-- ACTIVE function, which has a DIFFERENT signature:
--   admin_search_profiles(text, text, boolean, boolean, boolean, boolean, integer, integer)
--   (… p_onboarding_completed, p_zero_activity …) — added in 20260616120000.
DROP FUNCTION IF EXISTS public.admin_search_profiles(text, text, text, boolean, boolean, integer, integer, text);

NOTIFY pgrst, 'reload schema';
