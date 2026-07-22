-- Feed RPCs: expose home_feed_items.author_role on every returned item.
--
-- WHY: vacancies can be COACH-published (publisher_role exists on
-- opportunity_posted metadata), and the derived events club_responded /
-- role_filled attribute the "club_*" metadata fields to the PUBLISHER —
-- which for a coach is their personal profile. The client's Happening-now
-- rows and feed cards hardcoded /clubs/id/<club_id> for those types, so
-- tapping "<coach> reviewed N applications" opened the club profile page
-- with a coach's profile id -> "Club profile not found" (live prod repro:
-- coach be7670a0, item 98877fc8, 2026-07-21).
--
-- The role is already stored on EVERY home_feed_items row (author_role,
-- 0 NULLs on prod) — the RPCs just never returned it. Merging the column
-- into the item JSON fixes historical rows too (no backfill needed) and
-- lets the client route by role. user_post branches already emit
-- author_role from profiles; metadata keys are overridden by the column
-- (column is authoritative).
--
-- Bodies below are verbatim copies of the LIVE prod definitions
-- (md5-verified identical on prod + staging, 2026-07-22) with ONLY the
-- 'author_role' additions.

-- ---------------------------------------------------------------------------
-- get_market_moves: + 'author_role' in the item merge
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_market_moves(p_limit integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB;
  v_user_id UUID := auth.uid();
  v_is_test BOOLEAN;
  v_blocked_ids UUID[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT is_staging_env() OR COALESCE(is_test_account, false) INTO v_is_test
  FROM profiles WHERE id = v_user_id;

  -- Bidirectional: caller blocked them OR they blocked caller (same
  -- semantics as get_home_feed / is_blocked_pair).
  SELECT COALESCE(array_agg(other_id), ARRAY[]::UUID[])
    INTO v_blocked_ids
    FROM (
      SELECT blocked_id AS other_id FROM user_blocks WHERE blocker_id = v_user_id
      UNION
      SELECT blocker_id AS other_id FROM user_blocks WHERE blocked_id = v_user_id
    ) blocks;

  SELECT COALESCE(jsonb_agg(c.item_data ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      hfi.created_at,
      hfi.metadata || jsonb_build_object(
        'feed_item_id', hfi.id,
        'item_type', hfi.item_type,
        'created_at', hfi.created_at,
        'author_role', hfi.author_role
      ) AS item_data
    FROM home_feed_items hfi
    WHERE hfi.deleted_at IS NULL
      AND hfi.item_type IN (
        'opportunity_posted', 'role_filled', 'career_move',
        'open_to_play_confirmed', 'media_added', 'video_added', 'club_responded'
      )
      AND (v_is_test OR hfi.is_test_account = false)
      AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
      -- age-gate: items by hidden authors vanish (NULL authors pass)
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles hp
        WHERE hp.id = hfi.author_profile_id
          AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at)
      )
    ORDER BY hfi.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20)
  ) c;

  RETURN v_items;
END;
$function$;

-- ---------------------------------------------------------------------------
-- get_home_feed: + 'author_role' in both home_feed_items merges (the
-- user_post branches already emit it from profiles).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_home_feed(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_item_type text DEFAULT NULL::text, p_country_ids integer[] DEFAULT NULL::integer[], p_roles text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB;
  v_total BIGINT;
  v_user_id UUID := auth.uid();
  v_is_test BOOLEAN;
  v_blocked_ids UUID[];
BEGIN
  SELECT is_staging_env() OR COALESCE(is_test_account, false) INTO v_is_test
  FROM profiles WHERE id = v_user_id;

  -- Bidirectional: caller blocked them OR they blocked caller. Matches
  -- the semantics of public.is_blocked_pair used by enqueue_notification.
  SELECT COALESCE(array_agg(other_id), ARRAY[]::UUID[])
    INTO v_blocked_ids
    FROM (
      SELECT blocked_id AS other_id FROM user_blocks WHERE blocker_id = v_user_id
      UNION
      SELECT blocker_id AS other_id FROM user_blocks WHERE blocked_id = v_user_id
    ) blocks;

  IF p_item_type IS NULL OR p_item_type = '' THEN

    SELECT (
      (SELECT COUNT(*)
       FROM home_feed_items hfi
       WHERE hfi.deleted_at IS NULL
         AND hfi.item_type NOT IN ('member_joined', 'career_move')
         AND (v_is_test OR hfi.is_test_account = false)
         AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
         -- age-gate: items by hidden authors vanish (NULL authors pass)
         AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
         AND (
           p_roles IS NULL
           OR hfi.author_role = ANY(p_roles)
         )
         AND (
           p_country_ids IS NULL
           OR hfi.item_type IN ('brand_post', 'brand_product')
           OR hfi.author_role = 'brand'
           OR hfi.author_country_id = ANY(p_country_ids)
         )
      )
      +
      (SELECT COUNT(*)
       FROM user_posts up
       JOIN profiles p ON p.id = up.author_id
       WHERE up.deleted_at IS NULL
         AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
         AND NOT (up.author_id = ANY(v_blocked_ids))
         -- age-gate: posts by hidden authors vanish
         AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
         AND (
           p_roles IS NULL
           OR p.role = ANY(p_roles)
         )
         AND (
           p_country_ids IS NULL
           OR p.role = 'brand'
           OR p.nationality_country_id = ANY(p_country_ids)
         )
      )
    ) INTO v_total;

    SELECT COALESCE(jsonb_agg(c.item_data ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT item_data, created_at FROM (
        SELECT
          hfi.created_at,
          hfi.metadata || jsonb_build_object(
            'feed_item_id', hfi.id,
            'item_type', hfi.item_type,
            'created_at', hfi.created_at,
            'author_role', hfi.author_role
          ) AS item_data
        FROM home_feed_items hfi
        WHERE hfi.deleted_at IS NULL
          AND hfi.item_type NOT IN ('member_joined', 'career_move')
          AND (v_is_test OR hfi.is_test_account = false)
          AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
          -- age-gate: items by hidden authors vanish (NULL authors pass)
          AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
          AND (
            p_roles IS NULL
            OR hfi.author_role = ANY(p_roles)
          )
          AND (
            p_country_ids IS NULL
            OR hfi.item_type IN ('brand_post', 'brand_product')
            OR hfi.author_role = 'brand'
            OR hfi.author_country_id = ANY(p_country_ids)
          )

        UNION ALL

        SELECT
          up.created_at,
          jsonb_build_object(
            'feed_item_id', up.id,
            'item_type', 'user_post',
            'created_at', up.created_at,
            'post_id', up.id,
            'author_id', up.author_id,
            'author_name', COALESCE(b.name, p.full_name),
            'author_avatar', COALESCE(b.logo_url, p.avatar_url),
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
        LEFT JOIN brands b ON b.profile_id = p.id
        WHERE up.deleted_at IS NULL
          AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
          AND NOT (up.author_id = ANY(v_blocked_ids))
          -- age-gate: posts by hidden authors vanish
          AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
          AND (
            p_roles IS NULL
            OR p.role = ANY(p_roles)
          )
          AND (
            p_country_ids IS NULL
            OR p.role = 'brand'
            OR p.nationality_country_id = ANY(p_country_ids)
          )
      ) unified
      ORDER BY created_at DESC
      LIMIT p_limit OFFSET p_offset
    ) c;

    RETURN jsonb_build_object('items', v_items, 'total', v_total);
  END IF;

  IF p_item_type != 'user_post' THEN
    SELECT COUNT(*) INTO v_total
    FROM home_feed_items hfi
    WHERE hfi.deleted_at IS NULL
      AND hfi.item_type = p_item_type
      AND hfi.item_type NOT IN ('member_joined', 'career_move')
      AND (v_is_test OR hfi.is_test_account = false)
      AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
      -- age-gate: items by hidden authors vanish (NULL authors pass)
      AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
      AND (p_roles IS NULL OR hfi.author_role = ANY(p_roles))
      AND (
        p_country_ids IS NULL
        OR hfi.item_type IN ('brand_post', 'brand_product')
        OR hfi.author_role = 'brand'
        OR hfi.author_country_id = ANY(p_country_ids)
      );

    SELECT COALESCE(jsonb_agg(
      hfi.metadata || jsonb_build_object(
        'feed_item_id', hfi.id,
        'item_type', hfi.item_type,
        'created_at', hfi.created_at,
        'author_role', hfi.author_role
      )
      ORDER BY hfi.created_at DESC
    ), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT id, item_type, metadata, created_at, author_role
      FROM home_feed_items hfi2
      WHERE hfi2.deleted_at IS NULL
        AND hfi2.item_type = p_item_type
        AND hfi2.item_type NOT IN ('member_joined', 'career_move')
        AND (v_is_test OR hfi2.is_test_account = false)
        AND (hfi2.author_profile_id IS NULL OR NOT (hfi2.author_profile_id = ANY(v_blocked_ids)))
        -- age-gate: items by hidden authors vanish (NULL authors pass)
        AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi2.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
        AND (p_roles IS NULL OR hfi2.author_role = ANY(p_roles))
        AND (
          p_country_ids IS NULL
          OR hfi2.item_type IN ('brand_post', 'brand_product')
          OR hfi2.author_role = 'brand'
          OR hfi2.author_country_id = ANY(p_country_ids)
        )
      ORDER BY created_at DESC
      LIMIT p_limit OFFSET p_offset
    ) hfi;

    RETURN jsonb_build_object('items', v_items, 'total', v_total);
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM user_posts up
  JOIN profiles p ON p.id = up.author_id
  WHERE up.deleted_at IS NULL
    AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
    AND NOT (up.author_id = ANY(v_blocked_ids))
    -- age-gate: posts by hidden authors vanish
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND (p_roles IS NULL OR p.role = ANY(p_roles))
    AND (
      p_country_ids IS NULL
      OR p.role = 'brand'
      OR p.nationality_country_id = ANY(p_country_ids)
    );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'feed_item_id', up.id,
      'item_type', 'user_post',
      'created_at', up.created_at,
      'post_id', up.id,
      'author_id', up.author_id,
      'author_name', COALESCE(b.name, p.full_name),
      'author_avatar', COALESCE(b.logo_url, p.avatar_url),
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
      AND NOT (up2.author_id = ANY(v_blocked_ids))
      -- age-gate: posts by hidden authors vanish
      AND NOT public.profile_is_hidden(p2.is_blocked, p2.frozen_minor_at)
      AND (p_roles IS NULL OR p2.role = ANY(p_roles))
      AND (
        p_country_ids IS NULL
        OR p2.role = 'brand'
        OR p2.nationality_country_id = ANY(p_country_ids)
      )
    ORDER BY up2.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) up
  JOIN profiles p ON p.id = up.author_id
  LEFT JOIN brands b ON b.profile_id = p.id;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$function$;
