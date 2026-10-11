-- Home v1 (Figma t24oVt… H11b / H14 / H1 people row).
--
-- 1. create_signing_post takes the role and the season shown on the New
--    signing card ("Defender · Women's 1st team · 2027") and stores the club's
--    name + crest in the metadata. notify_signing_tagged already reads
--    metadata->>'club_name', which the old body never wrote.
--    Old clients call it with the three original named args; the new ones
--    default to NULL, so they keep working.
-- 2. get_new_members: the newest members for the Home "New in the community"
--    row. It re-sorts community_search_members by created_at, so every
--    visibility fence (hidden, blocked either side, age gate, club-facing 18+)
--    is exactly the Community one. SECURITY INVOKER: auth.uid() stays the viewer.

DROP FUNCTION IF EXISTS public.create_signing_post(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.create_signing_post(
  p_person_profile_id uuid,
  p_content text DEFAULT NULL,
  p_images jsonb DEFAULT NULL,
  p_role_label text DEFAULT NULL,
  p_season text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_post_id UUID;
  v_trimmed TEXT;
  v_metadata JSONB;
  v_rate_check JSONB;
  v_is_test BOOLEAN;
  v_club_name TEXT;
  v_club_avatar TEXT;
  v_club_role TEXT;
  v_person_name TEXT;
  v_person_avatar TEXT;
  v_person_role TEXT;
  v_person_position TEXT;
  v_role_label TEXT := NULLIF(trim(COALESCE(p_role_label, '')), '');
  v_season TEXT := NULLIF(trim(COALESCE(p_season, '')), '');
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT p.role, p.full_name, p.avatar_url, COALESCE(p.is_test_account, false)
  INTO v_club_role, v_club_name, v_club_avatar, v_is_test
  FROM profiles p WHERE p.id = v_user_id;

  IF v_club_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  IF v_club_role != 'club' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only clubs can create signing announcements');
  END IF;

  IF NOT v_is_test THEN
    v_rate_check := public.check_rate_limit(v_user_id::TEXT, 'create_post', 10, 3600);
    IF NOT (v_rate_check ->> 'allowed')::BOOLEAN THEN
      RETURN jsonb_build_object('success', false, 'error', 'Rate limit exceeded: maximum 10 posts per hour');
    END IF;
  END IF;

  IF p_person_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Person profile ID is required');
  END IF;

  IF v_role_label IS NOT NULL AND char_length(v_role_label) > 60 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Role must be 60 characters or fewer');
  END IF;
  IF v_season IS NOT NULL AND char_length(v_season) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season must be 20 characters or fewer');
  END IF;

  SELECT p.full_name, p.avatar_url, p.role, p.position
  INTO v_person_name, v_person_avatar, v_person_role, v_person_position
  FROM profiles p
  WHERE p.id = p_person_profile_id
    AND p.role IN ('player', 'coach')
    AND p.onboarding_completed = true;

  IF v_person_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player or coach not found');
  END IF;

  v_metadata := jsonb_build_object(
    'person_name', v_person_name,
    'person_role', v_person_role,
    'person_avatar_url', v_person_avatar,
    'person_profile_id', p_person_profile_id,
    'person_position', v_person_position,
    'club_name', v_club_name,
    'club_avatar_url', v_club_avatar,
    'signing_role', v_role_label,
    'season', v_season
  );

  v_trimmed := trim(COALESCE(p_content, ''));
  IF v_trimmed = '' THEN
    v_trimmed := 'Welcome ' || v_person_name || ' to ' || v_club_name || '!';
  END IF;

  IF char_length(v_trimmed) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Content exceeds 2000 character limit');
  END IF;

  IF p_images IS NOT NULL AND jsonb_array_length(p_images) > 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum 4 images allowed');
  END IF;

  IF p_images IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_images) i
    WHERE i ->> 'media_type' = 'video' AND i ? 'video_id'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Video attachments are not supported on announcements');
  END IF;

  INSERT INTO user_posts (author_id, content, images, post_type, metadata)
  VALUES (v_user_id, v_trimmed, p_images, 'signing', v_metadata)
  RETURNING id INTO v_post_id;

  RETURN jsonb_build_object('success', true, 'post_id', v_post_id);
END;
$function$;

COMMENT ON FUNCTION public.create_signing_post(uuid, text, jsonb, text, text) IS
  'Creates a New signing post for a club: tags a player/coach (18+, trigger guard), with optional role and season for the card. The tagged member is notified and can remove the tag.';

REVOKE ALL ON FUNCTION public.create_signing_post(uuid, text, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_signing_post(uuid, text, jsonb, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_new_members(p_limit integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 30);
  v_all jsonb;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  v_all := public.community_search_members(p_limit => 500);
  SELECT COALESCE(jsonb_agg(r.e ORDER BY (r.e->>'created_at')::timestamptz DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT e
        FROM jsonb_array_elements(COALESCE(v_all->'results', '[]'::jsonb)) e
       WHERE (e->>'id')::uuid IS DISTINCT FROM auth.uid()
         AND e->>'role' IN ('player', 'coach', 'club', 'umpire')
       ORDER BY (e->>'created_at')::timestamptz DESC
       LIMIT v_limit
    ) r;
  RETURN v_rows;
END;
$function$;

COMMENT ON FUNCTION public.get_new_members(integer) IS
  'Home "New in the community": newest members, same fences as community_search_members.';

REVOKE ALL ON FUNCTION public.get_new_members(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_new_members(integer) TO authenticated, service_role;
