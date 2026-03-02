-- ============================================================================
-- Migration: Club Signing Posts
-- Date: 2026-03-02
-- Description: Adds role-specific transfer behavior for Clubs.
--   Clubs announce "New Signing" (player/coach joins) instead of transferring
--   to another club. Adds post_type='signing', search_people_for_signing RPC,
--   and create_signing_post RPC.
-- ============================================================================

SET search_path = public;

-- 1. Expand post_type CHECK constraint to include 'signing'
ALTER TABLE user_posts DROP CONSTRAINT IF EXISTS user_posts_post_type_check;
ALTER TABLE user_posts ADD CONSTRAINT user_posts_post_type_check
  CHECK (post_type IN ('text', 'transfer', 'signing'));

-- 2. Index for signing posts (mirrors idx_user_posts_transfer)
CREATE INDEX IF NOT EXISTS idx_user_posts_signing
  ON public.user_posts (author_id, created_at DESC)
  WHERE post_type = 'signing' AND deleted_at IS NULL;

-- ============================================================================
-- RPC: search_people_for_signing
-- Searches players and coaches by name for club signing announcements.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_people_for_signing(
  p_query TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  avatar_url TEXT,
  "role" TEXT,
  "position" TEXT,
  current_club TEXT,
  base_location TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_normalized TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  v_normalized := lower(trim(p_query));

  IF char_length(v_normalized) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    p.role,
    p.position,
    p.current_club,
    p.base_location
  FROM profiles p
  WHERE p.role IN ('player', 'coach')
    AND p.onboarding_completed = true
    AND p.id != v_user_id
    AND lower(p.full_name) LIKE '%' || v_normalized || '%'
  ORDER BY
    CASE WHEN lower(p.full_name) LIKE v_normalized || '%' THEN 0 ELSE 1 END,
    p.full_name ASC
  LIMIT LEAST(p_limit, 20);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_people_for_signing(TEXT, INT) TO authenticated;
COMMENT ON FUNCTION public.search_people_for_signing IS 'Searches players and coaches by name for club signing announcements.';

-- ============================================================================
-- RPC: create_signing_post
-- Creates a "New Signing" announcement post for a Club profile.
-- The club selects a player/coach who has joined them.
-- No side effects on the signed person's profile.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_signing_post(
  p_person_profile_id UUID,
  p_content TEXT DEFAULT NULL,
  p_images JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Insert the signing post
  INSERT INTO user_posts (author_id, content, images, post_type, metadata)
  VALUES (v_user_id, v_trimmed, p_images, 'signing', v_metadata)
  RETURNING id INTO v_post_id;

  RETURN jsonb_build_object('success', true, 'post_id', v_post_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_signing_post(UUID, TEXT, JSONB) TO authenticated;
COMMENT ON FUNCTION public.create_signing_post IS 'Creates a new signing announcement post for a Club. The club selects a player/coach who has joined. No side effects on the signed person profile.';
