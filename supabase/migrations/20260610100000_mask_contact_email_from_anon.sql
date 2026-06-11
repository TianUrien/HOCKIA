-- ============================================================================
-- Mask contact_email from anon — PHASE A (additive, safe to apply anytime)
-- ============================================================================
-- Problem: anon was granted SELECT on profiles.contact_email
-- (20260528120000_restore_anon_profile_column_grants.sql), and the
-- contact_email_public consent flag was enforced ONLY in client JS
-- (lib/profileHelpers.ts). A logged-out actor could run
--   supabase.from('profiles').select('contact_email').not('contact_email','is',null)
-- and harvest every onboarded user's email regardless of their privacy setting.
--
-- Fix is two-phase for zero-downtime:
--   PHASE A (this file): add a STORED generated column `contact_email_masked`
--     (NULL unless contact_email_public=true) and GRANT it to anon. Purely
--     additive — nothing breaks, raw column still granted.
--   then deploy the client build that selects `contact_email:contact_email_masked`
--     (client/src/lib/publicProfileFields.ts).
--   PHASE B (20260610100300_revoke_raw_contact_email_from_anon.sql): REVOKE the
--     raw column from anon once the new client is live.
--
-- `authenticated` keeps the raw grant on purpose so the owner's own
-- `select('*')` (client/src/lib/auth.ts) still loads their email to edit.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contact_email_masked text
  GENERATED ALWAYS AS (
    CASE WHEN contact_email_public THEN contact_email ELSE NULL END
  ) STORED;

COMMENT ON COLUMN public.profiles.contact_email_masked IS
  'Anon-safe contact email: NULL unless contact_email_public=true. Anon reads THIS; the raw contact_email column is revoked from anon in 20260610100300.';

GRANT SELECT (contact_email_masked) ON public.profiles TO anon, authenticated;
