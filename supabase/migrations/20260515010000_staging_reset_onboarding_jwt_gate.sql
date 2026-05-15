-- Fix: swap GUC-based gate for JWT-issuer gate
-- ============================================================================
-- The original 20260515000000 migration gated staging_reset_onboarding() on
-- `current_setting('app.environment')`, which required:
--     ALTER DATABASE postgres SET app.environment = 'staging';
-- That ALTER DATABASE is blocked on Supabase's managed Postgres (permission
-- denied even for the dashboard's postgres role), so the gate would never
-- pass — making the function unusable on staging too.
--
-- This migration swaps the gate to use the JWT issuer URL, which is set by
-- Supabase Auth at token-mint time and is project-specific. The staging
-- project's issuer is hardcoded below. When the migration ships to prod, the
-- function exists but every auth'd call from prod fails the check (because
-- prod's JWT iss is the prod project URL, not the staging URL). Three layers
-- of defence:
--
--   1. Frontend gate: VITE_ENVIRONMENT === 'staging' (only ships in staging
--      build, so the button never appears on prod)
--   2. JWT iss gate: the auth.jwt()'s iss claim must start with the staging
--      project URL (this is set by Supabase at JWT mint time; not forgeable
--      by clients; project-specific without any database-level config)
--   3. Auth gate: auth.uid() must be non-null — caller can only reset
--      themselves, never another user

CREATE OR REPLACE FUNCTION public.staging_reset_onboarding()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_iss TEXT;
  v_user_id UUID;
BEGIN
  -- Layer 1: JWT issuer must match the staging project's auth URL.
  -- On prod, the iss claim is https://xtertgftujnebubxgqit.supabase.co/...
  -- and this check raises before any data mutation.
  v_iss := auth.jwt() ->> 'iss';
  IF v_iss IS NULL OR v_iss NOT LIKE 'https://ivjkdaylalhsteyyclvl.supabase.co%' THEN
    RAISE EXCEPTION 'staging_reset_onboarding is staging-only (iss: %)', COALESCE(v_iss, 'NULL');
  END IF;

  -- Layer 2: caller must be authenticated; operates on self only.
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'staging_reset_onboarding requires an authenticated caller';
  END IF;

  -- Reset universal onboarding fields. Role preserved (NOT NULL column).
  UPDATE public.profiles
  SET
    full_name = NULL,
    base_location = NULL,
    base_city = NULL,
    base_country_id = NULL,
    nationality = NULL,
    nationality_country_id = NULL,
    nationality2_country_id = NULL,
    gender = NULL,
    date_of_birth = NULL,
    avatar_url = NULL,
    bio = NULL,
    onboarding_completed = FALSE,
    onboarding_completed_at = NULL,
    onboarding_started_at = NULL,
    category_confirmation_needed = FALSE,

    -- Player-specific
    position = NULL,
    secondary_position = NULL,
    playing_category = NULL,
    current_club = NULL,
    current_world_club_id = NULL,
    open_to_play = FALSE,

    -- Coach-specific
    coaching_categories = NULL,
    coach_specialization = NULL,
    coach_specialization_custom = NULL,
    coach_recruits_for_team = FALSE,
    open_to_coach = FALSE,

    -- Umpire-specific
    umpiring_categories = NULL,
    umpire_level = NULL,
    federation = NULL,
    umpire_since = NULL,
    officiating_specialization = NULL,
    languages = NULL,

    -- Club-specific
    year_founded = NULL,
    womens_league_division = NULL,
    mens_league_division = NULL,
    website = NULL,
    contact_email = NULL,
    club_bio = NULL,
    club_history = NULL,

    updated_at = NOW()
  WHERE id = v_user_id;
END;
$$;

COMMENT ON FUNCTION public.staging_reset_onboarding() IS
  'Staging-only QA helper. Resets calling user''s onboarding state so the flow can be tested repeatedly. Gated on JWT issuer (ivjkdaylalhsteyyclvl) — errors on prod because the JWT iss claim there is the prod project URL.';
