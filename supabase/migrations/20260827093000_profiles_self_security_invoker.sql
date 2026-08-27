-- Audit 2026-08-27, follow-up to 20260827090000_harden_definer_views.sql.
--
-- profiles_self no longer needs to run as its owner: every column it exposes
-- is column-granted SELECT to `authenticated` on public.profiles, and the
-- "Users can view their own profile" policy (auth.uid() = id) admits exactly
-- the row the view's WHERE clause selects. Running it as the caller yields
-- the same result for members while removing the last SECURITY DEFINER view
-- flagged ERROR by the Supabase security advisor. Grants unchanged (SELECT
-- only for end users, per the previous migration).
ALTER VIEW public.profiles_self SET (security_invoker = true);
