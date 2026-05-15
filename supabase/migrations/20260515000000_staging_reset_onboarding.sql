-- staging_reset_onboarding()
-- ============================================================================
-- Staging-only RPC that clears the calling user's onboarding state so a single
-- test account can run the onboarding flow repeatedly without manual cleanup.
--
-- HARD GATE (defence in depth):
--   1. Function body errors unless current_setting('app.environment') = 'staging'.
--      Staging Supabase project must have:
--        ALTER DATABASE postgres SET app.environment = 'staging';
--      run ONCE manually. Production must NOT have this setting (or set it to
--      anything else). If this migration ships to prod, the function exists but
--      raises on every call — it cannot mutate prod data.
--   2. Operates only on auth.uid() — no parameter — so even if it ran, a user
--      could only reset their own onboarding, never someone else's.
--   3. EXECUTE granted to `authenticated` only; revoked from `public` / `anon`.
--
-- WHAT IT RESETS:
--   * profiles fields filled during CompleteProfile (player/coach/umpire/club)
--   * onboarding_completed flag back to false
--   * Role-specific fields (positions, categories, club bio, etc.)
--
-- WHAT IT PRESERVES:
--   * auth.users row (so user can sign in again with same credentials)
--   * profiles.role (NOT NULL column — to test the role-picker step itself,
--     sign up with a Gmail alias like `playrplayer93+test01@gmail.com`)
--   * profiles.email, id, created_at (identity)
--   * Notification preferences, counts, last_*_at timestamps (audit + settings)

CREATE OR REPLACE FUNCTION public.staging_reset_onboarding()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Layer 1: env gate. NULL-safe via second arg `true`.
  IF current_setting('app.environment', true) IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'staging_reset_onboarding is staging-only (app.environment != ''staging'')';
  END IF;

  -- Layer 2: caller must be authenticated; operates on self only.
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'staging_reset_onboarding requires an authenticated caller';
  END IF;

  -- Reset universal onboarding fields. Role is preserved (NOT NULL column).
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

REVOKE ALL ON FUNCTION public.staging_reset_onboarding() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staging_reset_onboarding() FROM anon;
GRANT EXECUTE ON FUNCTION public.staging_reset_onboarding() TO authenticated;

COMMENT ON FUNCTION public.staging_reset_onboarding() IS
  'Staging-only QA helper. Resets calling user''s onboarding state so the flow can be tested repeatedly. Errors in production via current_setting(''app.environment'') gate.';
