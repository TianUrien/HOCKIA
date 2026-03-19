-- Prevent end users from changing their profile role via the onboarding RPC
BEGIN;

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
  p_year_founded INTEGER DEFAULT NULL,
  p_passport_1 TEXT DEFAULT NULL,
  p_passport_2 TEXT DEFAULT NULL
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
    passport_1 = COALESCE(p_passport_1, passport_1),
    passport_2 = COALESCE(p_passport_2, passport_2),
    onboarding_completed = TRUE,
    updated_at = timezone('utc', now())
  WHERE id = p_user_id
  RETURNING * INTO updated_profile;

  RETURN updated_profile;
END;
$$;

COMMIT;
