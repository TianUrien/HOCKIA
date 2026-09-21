-- get_home_feed: expose user_posts.post_type on every user_post item.
--
-- Questions are user_posts rows with post_type = 'question' (see
-- 20260920180000_user_posts_question_kind.sql). The feed card needs the kind
-- to render the "Question" pill, the top-answer preview and the Answer
-- action; until now the RPC only emitted content/images/counts.
--
-- Body below is the LIVE definition (md5 ded400640e798d133acf66f69b7687d0,
-- identical on prod and staging, verified 2026-09-20) with ONLY the three
-- post_type additions: both user_post jsonb_build_object payloads and the
-- inner up2 projection that feeds the user_post-only branch.

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
            'post_type', up.post_type,
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
      'post_type', up.post_type,
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
           up2.like_count, up2.comment_count, up2.created_at, up2.post_type
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
