-- ============================================================================
-- Remove passport fields from HOCKIA
-- Passports have been fully replaced by Nationality 1 / Nationality 2
-- (nationality_country_id and nationality2_country_id)
-- ============================================================================
-- OPERATION ORDER:
-- 1. Recreate views (remove passport column references)
-- 2. Recreate functions (remove passport parameters/clauses)
-- 3. Delete passport-related aliases from country_text_aliases
-- 4. Drop indexes
-- 5. Drop columns from profiles
-- ============================================================================

BEGIN;

SET search_path = public;

-- ============================================================================
-- STEP 1A: Recreate country_migration_stats view WITHOUT passport fields
-- Latest was in 202512101000_fix_security_definer_views.sql
-- Preserves: security_invoker = true, service_role only grants
-- ============================================================================
DROP VIEW IF EXISTS public.country_migration_stats CASCADE;

CREATE VIEW public.country_migration_stats
WITH (security_invoker = true)
AS
SELECT
  (SELECT COUNT(*) FROM public.profiles WHERE onboarding_completed = TRUE) AS total_completed_profiles,
  (SELECT COUNT(*) FROM public.profiles WHERE nationality IS NOT NULL AND TRIM(nationality) <> '') AS profiles_with_nationality_text,
  (SELECT COUNT(*) FROM public.profiles WHERE nationality_country_id IS NOT NULL) AS profiles_with_nationality_id,
  (SELECT COUNT(*) FROM public.profiles WHERE nationality IS NOT NULL AND TRIM(nationality) <> '' AND nationality_country_id IS NULL) AS nationality_pending_review;

REVOKE ALL ON public.country_migration_stats FROM authenticated;
GRANT SELECT ON public.country_migration_stats TO service_role;

COMMENT ON VIEW public.country_migration_stats IS 'Admin-only: Country data migration progress stats (passport fields removed)';

-- ============================================================================
-- STEP 1B: Recreate profiles_pending_country_review view WITHOUT passport fields
-- Latest was in 202512101000_fix_security_definer_views.sql
-- Preserves: security_invoker = true, service_role only grants
-- ============================================================================
DROP VIEW IF EXISTS public.profiles_pending_country_review CASCADE;

CREATE VIEW public.profiles_pending_country_review
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.full_name,
  p.email,
  p.role,
  p.nationality AS nationality_text,
  p.nationality_country_id,
  nc.name AS nationality_country_name,
  CASE
    WHEN p.nationality IS NOT NULL AND TRIM(p.nationality) <> '' AND p.nationality_country_id IS NULL THEN TRUE
    ELSE FALSE
  END AS nationality_needs_review
FROM public.profiles p
LEFT JOIN public.countries nc ON nc.id = p.nationality_country_id
WHERE
  (p.nationality IS NOT NULL AND TRIM(p.nationality) <> '' AND p.nationality_country_id IS NULL);

REVOKE ALL ON public.profiles_pending_country_review FROM authenticated;
GRANT SELECT ON public.profiles_pending_country_review TO service_role;

COMMENT ON VIEW public.profiles_pending_country_review IS 'Admin-only: Profiles needing nationality field review (passport fields removed)';

-- ============================================================================
-- STEP 2A: Recreate complete_user_profile() WITHOUT passport parameters
-- Latest was in 202511171440_lock_profile_roles.sql
-- Must DROP first: removing trailing params changes function signature
-- ============================================================================
DROP FUNCTION IF EXISTS public.complete_user_profile(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.complete_user_profile(
  p_user_id UUID,
  p_full_name TEXT,
  p_base_location TEXT,
  p_nationality TEXT,
  p_role TEXT,
  p_position TEXT DEFAULT NULL,
  p_secondary_position TEXT DEFAULT NULL,
  p_gender TEXT DEFAULT NULL,
  p_date_of_birth DATE DEFAULT NULL,
  p_current_club TEXT DEFAULT NULL,
  p_club_history TEXT DEFAULT NULL,
  p_highlight_video_url TEXT DEFAULT NULL,
  p_bio TEXT DEFAULT NULL,
  p_club_bio TEXT DEFAULT NULL,
  p_league_division TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_year_founded INTEGER DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requester_role TEXT := auth.role();
  requester_id UUID := auth.uid();
  target_profile public.profiles;
  updated_profile public.profiles;
  new_role TEXT;
BEGIN
  SELECT * INTO target_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found for user %', p_user_id;
  END IF;

  IF requester_role <> 'service_role' THEN
    IF requester_id IS NULL THEN
      RAISE EXCEPTION 'complete_user_profile requires authentication' USING ERRCODE = '42501';
    END IF;

    IF requester_id <> p_user_id THEN
      RAISE EXCEPTION 'Cannot complete profile % as user %', p_user_id, requester_id USING ERRCODE = '42501';
    END IF;

    IF p_role IS NOT NULL AND p_role <> target_profile.role THEN
      RAISE EXCEPTION 'Profile role is managed by HOCKIA staff';
    END IF;

    new_role := target_profile.role;
  ELSE
    new_role := COALESCE(p_role, target_profile.role);
  END IF;

  UPDATE public.profiles
  SET
    role = new_role,
    full_name = p_full_name,
    base_location = p_base_location,
    nationality = p_nationality,
    position = COALESCE(p_position, position),
    secondary_position = COALESCE(p_secondary_position, secondary_position),
    gender = COALESCE(p_gender, gender),
    date_of_birth = COALESCE(p_date_of_birth, date_of_birth),
    current_club = COALESCE(p_current_club, current_club),
    club_history = COALESCE(p_club_history, club_history),
    highlight_video_url = COALESCE(p_highlight_video_url, highlight_video_url),
    bio = COALESCE(p_bio, bio),
    club_bio = COALESCE(p_club_bio, club_bio),
    league_division = COALESCE(p_league_division, league_division),
    website = COALESCE(p_website, website),
    contact_email = COALESCE(p_contact_email, contact_email),
    year_founded = COALESCE(p_year_founded, year_founded),
    onboarding_completed = TRUE,
    updated_at = timezone('utc', now())
  WHERE id = p_user_id
  RETURNING * INTO updated_profile;

  RETURN updated_profile;
END;
$$;

-- ============================================================================
-- STEP 2B: Recreate admin_update_profile() WITHOUT passport fields
-- Latest was in 202512111000_admin_update_nationality_fields.sql
-- Same signature (UUID, JSONB, TEXT) — CREATE OR REPLACE is safe
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_update_profile(
  p_profile_id UUID,
  p_updates JSONB,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_data JSONB;
  v_new_data JSONB;
  v_allowed_fields TEXT[] := ARRAY[
    'full_name', 'username', 'email', 'bio', 'club_bio',
    'nationality', 'nationality_country_id', 'nationality2_country_id',
    'base_location', 'position', 'secondary_position',
    'gender', 'date_of_birth', 'current_club',
    'is_test_account', 'onboarding_completed'
  ];
  v_field TEXT;
BEGIN
  -- Verify caller is admin
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Validate fields
  FOR v_field IN SELECT jsonb_object_keys(p_updates)
  LOOP
    IF NOT v_field = ANY(v_allowed_fields) THEN
      RAISE EXCEPTION 'Field not allowed for admin update: %', v_field;
    END IF;
  END LOOP;

  -- Get current state
  SELECT to_jsonb(p.*)
  INTO v_old_data
  FROM profiles p
  WHERE p.id = p_profile_id;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'Profile not found: %', p_profile_id;
  END IF;

  -- Execute update with all editable fields
  UPDATE profiles
  SET
    full_name = COALESCE(p_updates ->> 'full_name', full_name),
    username = COALESCE(p_updates ->> 'username', username),
    email = COALESCE(p_updates ->> 'email', email),
    bio = COALESCE(p_updates ->> 'bio', bio),
    club_bio = COALESCE(p_updates ->> 'club_bio', club_bio),
    nationality = COALESCE(p_updates ->> 'nationality', nationality),
    nationality_country_id = COALESCE((p_updates ->> 'nationality_country_id')::INTEGER, nationality_country_id),
    nationality2_country_id = COALESCE((p_updates ->> 'nationality2_country_id')::INTEGER, nationality2_country_id),
    base_location = COALESCE(p_updates ->> 'base_location', base_location),
    position = COALESCE(p_updates ->> 'position', position),
    secondary_position = COALESCE(p_updates ->> 'secondary_position', secondary_position),
    gender = COALESCE(p_updates ->> 'gender', gender),
    date_of_birth = COALESCE((p_updates ->> 'date_of_birth')::DATE, date_of_birth),
    current_club = COALESCE(p_updates ->> 'current_club', current_club),
    is_test_account = COALESCE((p_updates ->> 'is_test_account')::BOOLEAN, is_test_account),
    onboarding_completed = COALESCE((p_updates ->> 'onboarding_completed')::BOOLEAN, onboarding_completed),
    updated_at = now()
  WHERE id = p_profile_id;

  -- Get new state
  SELECT to_jsonb(p.*)
  INTO v_new_data
  FROM profiles p
  WHERE p.id = p_profile_id;

  -- Log the action
  PERFORM public.admin_log_action(
    'update_profile',
    'profile',
    p_profile_id,
    v_old_data,
    v_new_data,
    jsonb_build_object('reason', p_reason, 'fields_updated', (SELECT array_agg(k) FROM jsonb_object_keys(p_updates) k))
  );

  RETURN json_build_object(
    'success', true,
    'profile_id', p_profile_id,
    'updated_fields', (SELECT array_agg(k) FROM jsonb_object_keys(p_updates) k)
  );
END;
$$;

COMMENT ON FUNCTION public.admin_update_profile IS 'Updates profile fields with audit logging (passport fields removed)';
GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, JSONB, TEXT) TO authenticated;

-- ============================================================================
-- STEP 2C: Recreate admin_resolve_country_mapping() WITHOUT passport branches
-- Latest body from 202512091000_countries_normalization.sql
-- Privileges hardened in 202512101002
-- Same signature (UUID, TEXT, INTEGER) — CREATE OR REPLACE is safe
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_resolve_country_mapping(
  p_profile_id UUID,
  p_field TEXT,
  p_country_id INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: only service_role can resolve country mappings';
  END IF;

  IF p_field = 'nationality' THEN
    UPDATE public.profiles SET nationality_country_id = p_country_id WHERE id = p_profile_id;
  ELSIF p_field = 'base_country' THEN
    UPDATE public.profiles SET base_country_id = p_country_id WHERE id = p_profile_id;
  ELSE
    RAISE EXCEPTION 'Invalid field: %. Must be nationality or base_country', p_field;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_resolve_country_mapping IS 'Admin function to manually map a profile field to a country_id (passport branches removed)';

-- Maintain hardened privileges from 202512101002
REVOKE EXECUTE ON FUNCTION public.admin_resolve_country_mapping(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_country_mapping(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_country_mapping(uuid, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_country_mapping(uuid, text, integer) TO service_role;

-- ============================================================================
-- STEP 3: Delete passport-related aliases from country_text_aliases
-- Inserted in 202512091100_countries_fix_aliases.sql
-- ============================================================================
DELETE FROM public.country_text_aliases
WHERE alias_text LIKE '%passport%'
   OR alias_text LIKE '%pasaporte%'
   OR alias_text LIKE '%passaporto%'
   OR alias_text LIKE '%passaporte%';

-- ============================================================================
-- STEP 4: Drop indexes
-- ============================================================================
DROP INDEX IF EXISTS idx_profiles_passport1_country;
DROP INDEX IF EXISTS idx_profiles_passport2_country;

-- ============================================================================
-- STEP 5: Drop columns from profiles
-- Foreign keys are dropped automatically when columns are dropped
-- ============================================================================
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS passport_1,
  DROP COLUMN IF EXISTS passport_2,
  DROP COLUMN IF EXISTS passport1_country_id,
  DROP COLUMN IF EXISTS passport2_country_id;

COMMIT;
