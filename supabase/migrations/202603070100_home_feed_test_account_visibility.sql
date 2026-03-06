-- ============================================================================
-- Fix: Add test-account visibility filtering to get_home_feed RPC
-- ============================================================================
-- Problem: get_home_feed_new_count correctly filters out test-account posts
-- for non-test users, but get_home_feed does NOT. This means test account
-- posts leak into real users' home feeds.
--
-- Fix: Add the same is_test_account filtering to all three branches of
-- get_home_feed (system items, user_post only, and unified feed).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_home_feed(
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0,
  p_item_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
  v_total BIGINT;
  v_user_id UUID := auth.uid();
  v_is_test BOOLEAN;
BEGIN
  -- Determine if current user is a test account
  SELECT COALESCE(is_test_account, false) INTO v_is_test
  FROM profiles WHERE id = v_user_id;

  -- If filtering by a specific system type, use original logic
  IF p_item_type IS NOT NULL AND p_item_type != 'user_post' THEN
    SELECT COUNT(*) INTO v_total
    FROM home_feed_items
    WHERE deleted_at IS NULL
      AND item_type = p_item_type
      AND (v_is_test OR is_test_account = false);

    SELECT COALESCE(jsonb_agg(
      hfi.metadata || jsonb_build_object(
        'feed_item_id', hfi.id,
        'item_type', hfi.item_type,
        'created_at', hfi.created_at
      )
      ORDER BY hfi.created_at DESC
    ), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT id, item_type, metadata, created_at
      FROM home_feed_items
      WHERE deleted_at IS NULL
        AND item_type = p_item_type
        AND (v_is_test OR is_test_account = false)
      ORDER BY created_at DESC
      LIMIT p_limit OFFSET p_offset
    ) hfi;

    RETURN jsonb_build_object('items', v_items, 'total', v_total);
  END IF;

  -- If filtering by user_post only
  IF p_item_type = 'user_post' THEN
    SELECT COUNT(*) INTO v_total
    FROM user_posts up
    JOIN profiles p ON p.id = up.author_id
    WHERE up.deleted_at IS NULL
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false);

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'feed_item_id', up.id,
        'item_type', 'user_post',
        'created_at', up.created_at,
        'post_id', up.id,
        'author_id', up.author_id,
        'author_name', p.full_name,
        'author_avatar', p.avatar_url,
        'author_role', p.role,
        'content', up.content,
        'images', up.images,
        'like_count', up.like_count,
        'comment_count', up.comment_count,
        'has_liked', EXISTS (
          SELECT 1 FROM post_likes pl
          WHERE pl.post_id = up.id AND pl.user_id = v_user_id
        )
      )
      ORDER BY up.created_at DESC
    ), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT up2.id, up2.author_id, up2.content, up2.images,
             up2.like_count, up2.comment_count, up2.created_at
      FROM user_posts up2
      JOIN profiles p2 ON p2.id = up2.author_id
      WHERE up2.deleted_at IS NULL
        AND (v_is_test OR p2.is_test_account IS NULL OR p2.is_test_account = false)
      ORDER BY up2.created_at DESC
      LIMIT p_limit OFFSET p_offset
    ) up
    JOIN profiles p ON p.id = up.author_id;

    RETURN jsonb_build_object('items', v_items, 'total', v_total);
  END IF;

  -- Default: UNION of system posts + user posts (unified feed)

  -- Count total from both sources (with test-account filtering)
  SELECT (
    (SELECT COUNT(*) FROM home_feed_items
     WHERE deleted_at IS NULL
       AND (v_is_test OR is_test_account = false)) +
    (SELECT COUNT(*) FROM user_posts up
     JOIN profiles p ON p.id = up.author_id
     WHERE up.deleted_at IS NULL
       AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false))
  ) INTO v_total;

  -- Fetch paginated items from unified feed
  SELECT COALESCE(jsonb_agg(
    c.item_data ORDER BY c.created_at DESC
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT item_data, created_at
    FROM (
      -- System posts
      SELECT
        hfi.created_at,
        hfi.metadata || jsonb_build_object(
          'feed_item_id', hfi.id,
          'item_type', hfi.item_type,
          'created_at', hfi.created_at
        ) AS item_data
      FROM home_feed_items hfi
      WHERE hfi.deleted_at IS NULL
        AND (v_is_test OR hfi.is_test_account = false)

      UNION ALL

      -- User posts
      SELECT
        up.created_at,
        jsonb_build_object(
          'feed_item_id', up.id,
          'item_type', 'user_post',
          'created_at', up.created_at,
          'post_id', up.id,
          'author_id', up.author_id,
          'author_name', p.full_name,
          'author_avatar', p.avatar_url,
          'author_role', p.role,
          'content', up.content,
          'images', up.images,
          'like_count', up.like_count,
          'comment_count', up.comment_count,
          'has_liked', EXISTS (
            SELECT 1 FROM post_likes pl
            WHERE pl.post_id = up.id AND pl.user_id = v_user_id
          )
        ) AS item_data
      FROM user_posts up
      JOIN profiles p ON p.id = up.author_id
      WHERE up.deleted_at IS NULL
        AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
    ) unified
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) c;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$$;

COMMENT ON FUNCTION public.get_home_feed IS
  'Returns paginated home feed (system items + user posts). Respects test-account visibility: non-test users never see test-account content.';
