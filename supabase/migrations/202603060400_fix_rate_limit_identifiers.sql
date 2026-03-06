-- Migration: Fix Rate Limit Identifiers (C-01)
-- Date: 2026-03-06
-- Description: Fixes the rate limit bypass vulnerability where the client could
--   choose its own identifier (random sessionStorage UUID). Now:
--   - Login and signup rate limits use the normalized email as identifier
--   - Parameters renamed from p_ip to p_email for clarity
--   - Email is normalized server-side (lower + trim) to prevent bypass via casing
--
-- NOTE: DROP + CREATE is required because PostgreSQL does not allow renaming
-- function parameters via CREATE OR REPLACE.

SET search_path = public;

-- ============================================================================
-- LOGIN RATE LIMIT: keyed on normalized email
-- 5 attempts per 15 minutes per email address
-- ============================================================================
DROP FUNCTION IF EXISTS public.check_login_rate_limit(TEXT);

CREATE FUNCTION public.check_login_rate_limit(p_email TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_rate_limit(lower(COALESCE(NULLIF(trim(p_email), ''), 'anonymous')), 'login_attempt', 5, 900);
$$;

COMMENT ON FUNCTION public.check_login_rate_limit IS 'Rate limit: 5 login attempts per 15 minutes per email address';

-- ============================================================================
-- SIGNUP RATE LIMIT: keyed on normalized email
-- 3 signups per hour per email address
-- ============================================================================
DROP FUNCTION IF EXISTS public.check_signup_rate_limit(TEXT);

CREATE FUNCTION public.check_signup_rate_limit(p_email TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.check_rate_limit(lower(COALESCE(NULLIF(trim(p_email), ''), 'anonymous')), 'signup', 3, 3600);
$$;

COMMENT ON FUNCTION public.check_signup_rate_limit IS 'Rate limit: 3 signups per hour per email address';

-- Ensure grants remain in place
GRANT EXECUTE ON FUNCTION public.check_login_rate_limit TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_signup_rate_limit TO anon, authenticated;
