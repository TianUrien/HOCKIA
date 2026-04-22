-- =========================================================================
-- admin_update_profile — Phase F4: allow editing umpire-specific columns
-- =========================================================================
-- Phase B1 left the admin EditUserModal with a "coming soon" banner for
-- umpire fields because the allowlist in admin_update_profile didn't
-- include them. Phase F4 closes that gap.
--
-- Fields added: umpire_level · federation · umpire_since ·
-- officiating_specialization · languages. The chk_umpire_fields_role
-- CHECK constraint on profiles still guarantees these columns stay NULL
-- unless role='umpire', so admins can't accidentally set an umpire field
-- on a player profile — the UPDATE would fail at the constraint level.
--
-- CASE WHEN (not COALESCE) is used for every umpire field so the admin
-- can explicitly clear a value by passing null in the JSONB payload.
-- COALESCE would silently keep the old value when null is passed, which
-- is the wrong semantic for admin remediation work.
-- =========================================================================

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
    'gender', 'date_of_birth', 'current_club', 'current_world_club_id',
    'is_test_account', 'onboarding_completed',
    -- Umpire-specific fields (Phase F4)
    'umpire_level', 'federation', 'umpire_since',
    'officiating_specialization', 'languages'
  ];
  v_field TEXT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  FOR v_field IN SELECT jsonb_object_keys(p_updates)
  LOOP
    IF NOT v_field = ANY(v_allowed_fields) THEN
      RAISE EXCEPTION 'Field not allowed for admin update: %', v_field;
    END IF;
  END LOOP;

  SELECT to_jsonb(p.*)
  INTO v_old_data
  FROM profiles p
  WHERE p.id = p_profile_id;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'Profile not found: %', p_profile_id;
  END IF;

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
    current_club = CASE
      WHEN p_updates ? 'current_club' THEN p_updates ->> 'current_club'
      ELSE current_club
    END,
    current_world_club_id = CASE
      WHEN p_updates ? 'current_world_club_id' THEN (p_updates ->> 'current_world_club_id')::UUID
      ELSE current_world_club_id
    END,
    is_test_account = COALESCE((p_updates ->> 'is_test_account')::BOOLEAN, is_test_account),
    onboarding_completed = COALESCE((p_updates ->> 'onboarding_completed')::BOOLEAN, onboarding_completed),
    -- Umpire fields — CASE WHEN pattern so admin can clear to NULL.
    umpire_level = CASE
      WHEN p_updates ? 'umpire_level' THEN p_updates ->> 'umpire_level'
      ELSE umpire_level
    END,
    federation = CASE
      WHEN p_updates ? 'federation' THEN p_updates ->> 'federation'
      ELSE federation
    END,
    umpire_since = CASE
      WHEN p_updates ? 'umpire_since' THEN (p_updates ->> 'umpire_since')::SMALLINT
      ELSE umpire_since
    END,
    officiating_specialization = CASE
      WHEN p_updates ? 'officiating_specialization' THEN p_updates ->> 'officiating_specialization'
      ELSE officiating_specialization
    END,
    languages = CASE
      WHEN p_updates ? 'languages' THEN
        CASE
          WHEN p_updates -> 'languages' IS NULL
            OR jsonb_typeof(p_updates -> 'languages') = 'null' THEN NULL
          ELSE ARRAY(SELECT jsonb_array_elements_text(p_updates -> 'languages'))
        END
      ELSE languages
    END,
    updated_at = now()
  WHERE id = p_profile_id;

  SELECT to_jsonb(p.*)
  INTO v_new_data
  FROM profiles p
  WHERE p.id = p_profile_id;

  PERFORM public.admin_log_action(
    'update_profile',
    'profile',
    p_profile_id,
    v_old_data,
    v_new_data,
    jsonb_build_object(
      'reason', p_reason,
      'fields_updated', (SELECT array_agg(k) FROM jsonb_object_keys(p_updates) k)
    )
  );

  RETURN json_build_object(
    'success', true,
    'profile_id', p_profile_id,
    'updated_fields', (SELECT array_agg(k) FROM jsonb_object_keys(p_updates) k)
  );
END;
$$;

COMMENT ON FUNCTION public.admin_update_profile IS
  'Updates profile fields with audit logging. Allowlist covers general profile fields + current_world_club_id + umpire-specific columns (umpire_level, federation, umpire_since, officiating_specialization, languages).';

GRANT EXECUTE ON FUNCTION public.admin_update_profile(UUID, JSONB, TEXT) TO authenticated;
