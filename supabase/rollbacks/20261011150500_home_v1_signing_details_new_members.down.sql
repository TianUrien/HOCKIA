-- Rollback for 20261011150500_home_v1_signing_details_new_members.sql
DROP FUNCTION IF EXISTS public.get_new_members(integer);
DROP FUNCTION IF EXISTS public.create_signing_post(uuid, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION "public"."create_signing_post"("p_person_profile_id" "uuid", "p_content" "text" DEFAULT NULL::"text", "p_images" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_post_id UUID;
  v_trimmed TEXT;
  v_metadata JSONB;
  v_rate_check JSONB;
  v_is_test BOOLEAN;
  v_club_name TEXT;
  v_club_role TEXT;
  v_person_name TEXT;
  v_person_avatar TEXT;
  v_person_role TEXT;
  v_person_position TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Verify the author is a club
  SELECT p.role, p.full_name, COALESCE(p.is_test_account, false)
  INTO v_club_role, v_club_name, v_is_test
  FROM profiles p WHERE p.id = v_user_id;

  IF v_club_role IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  IF v_club_role != 'club' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only clubs can create signing announcements');
  END IF;

  -- Rate limit check (same pool as regular posts)
  IF NOT v_is_test THEN
    v_rate_check := public.check_rate_limit(v_user_id::TEXT, 'create_post', 10, 3600);
    IF NOT (v_rate_check ->> 'allowed')::BOOLEAN THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Rate limit exceeded: maximum 10 posts per hour'
      );
    END IF;
  END IF;

  -- Validate and fetch the signed person
  IF p_person_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Person profile ID is required');
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

  -- Build signing metadata
  v_metadata := jsonb_build_object(
    'person_name', v_person_name,
    'person_role', v_person_role,
    'person_avatar_url', v_person_avatar,
    'person_profile_id', p_person_profile_id,
    'person_position', v_person_position
  );

  -- Use provided content or generate default
  v_trimmed := trim(COALESCE(p_content, ''));
  IF v_trimmed = '' THEN
    v_trimmed := 'Welcome ' || v_person_name || ' to ' || v_club_name || '!';
  END IF;

  IF char_length(v_trimmed) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Content exceeds 2000 character limit');
  END IF;

  -- Validate images
  IF p_images IS NOT NULL AND jsonb_array_length(p_images) > 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Maximum 4 images allowed');
  END IF;

  IF p_images IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_images) i
    WHERE i ->> 'media_type' = 'video' AND i ? 'video_id'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Video attachments are not supported on announcements');
  END IF;

  -- Insert the signing post
  INSERT INTO user_posts (author_id, content, images, post_type, metadata)
  VALUES (v_user_id, v_trimmed, p_images, 'signing', v_metadata)
  RETURNING id INTO v_post_id;

  RETURN jsonb_build_object('success', true, 'post_id', v_post_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_signing_post(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_signing_post(uuid, text, jsonb) TO anon, authenticated, service_role;
