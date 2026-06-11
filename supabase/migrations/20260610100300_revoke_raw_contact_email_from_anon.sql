-- ============================================================================
-- Mask contact_email from anon — PHASE B (the actual lockdown)
-- ============================================================================
-- Apply AFTER:
--   1. 20260610100000 (adds contact_email_masked + grant), and
--   2. the client build that selects `contact_email:contact_email_masked`
--      instead of the raw column is LIVE.
-- Applying this before the new client is deployed will 403 anon's existing
-- public-profile select (which still asks for the raw contact_email column).
--
-- After this revoke, anon can no longer read raw profiles.contact_email; the
-- only anon path to a contact email is the masked column, which is NULL unless
-- the owner opted in. `authenticated` retains the raw grant for owner
-- self-read (select('*') in client/src/lib/auth.ts).

REVOKE SELECT (contact_email) ON public.profiles FROM anon;
