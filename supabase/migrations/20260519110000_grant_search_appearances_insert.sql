-- profile_search_appearances was created with RLS + an INSERT policy but
-- no explicit table-level GRANT. PostgreSQL evaluates GRANTs before RLS,
-- so authenticated callers were getting 403 Forbidden on every POST to
-- /rest/v1/profile_search_appearances despite the policy allowing them.
-- The community page logs hundreds of these per session; QA flagged the
-- recurring console error.
--
-- Grant INSERT only (the existing SELECT policy already restricts reads
-- to platform admins, and SELECT through the RPC is gated separately).

GRANT INSERT ON TABLE public.profile_search_appearances TO authenticated;
