-- ============================================================================
-- rename_playr_to_hockia
-- ============================================================================
-- Cleans up the last PLAYR→HOCKIA references that earlier rebrand migrations
-- (202603190100 and 202604081000) did not cover:
--
--   1. Table comment on public.outreach_contacts
--   2. Column comment on public.brands.is_verified
--   3-5. description column on the three outreach email templates
--        (outreach_introduction, outreach_value_proof, outreach_social_proof)
--   6. Error text inside public.complete_user_profile() role-lock check
--
-- This migration was first applied directly on the HOCKIA project
-- (xtertgftujnebubxgqit) at 2026-04-19 01:17:25 UTC; this file recovers the
-- SQL from supabase_migrations.schema_migrations so the change is tracked in
-- git and can be replayed against hockia-staging.
-- ============================================================================

BEGIN;

-- 1. Update table comment on outreach_contacts
COMMENT ON TABLE public.outreach_contacts IS 'External contacts for outbound email campaigns (clubs, coaches not yet on HOCKIA)';

-- 2. Update column comment on brands.is_verified
COMMENT ON COLUMN public.brands.is_verified IS 'Whether the brand has been verified by HOCKIA staff (manual process)';

-- 3-5. Update email template descriptions
UPDATE public.email_templates
SET description = REPLACE(description, 'PLAYR', 'HOCKIA'),
    updated_at = NOW()
WHERE description LIKE '%PLAYR%';

-- 6. Recreate complete_user_profile function with HOCKIA in error message
CREATE OR REPLACE FUNCTION public.complete_user_profile(
  p_user_id uuid,
  p_full_name text,
  p_base_location text,
  p_nationality text,
  p_role text,
  p_position text DEFAULT NULL::text,
  p_secondary_position text DEFAULT NULL::text,
  p_gender text DEFAULT NULL::text,
  p_date_of_birth date DEFAULT NULL::date,
  p_current_club text DEFAULT NULL::text,
  p_club_history text DEFAULT NULL::text,
  p_highlight_video_url text DEFAULT NULL::text,
  p_bio text DEFAULT NULL::text,
  p_club_bio text DEFAULT NULL::text,
  p_league_division text DEFAULT NULL::text,
  p_website text DEFAULT NULL::text,
  p_contact_email text DEFAULT NULL::text,
  p_year_founded integer DEFAULT NULL::integer
)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

COMMIT;
