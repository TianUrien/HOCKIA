-- Staging-only: make test accounts discoverable to all users.
--
-- On staging, QA needs the test fixtures (test-flagged players, coaches,
-- clubs, brands) to be visible and interactable across every surface.
-- Production must be unaffected.
--
-- Mechanism: is_staging_env() returns true only when the request JWT was
-- issued by the staging Supabase project (auth.jwt()->>'iss') — the same
-- environment signal staging_reset_onboarding already relies on. It is
-- false on production and false for anonymous (no-JWT) callers, so:
--   * production behaviour is completely unchanged — this migration is a
--     prod no-op;
--   * logged-out / SEO traffic still never sees test accounts in either
--     environment (the `Anon` RLS policy and is_staging_env() agree).
--
-- Each visibility RPC already gates test content; we OR the existing
-- gate with is_staging_env(). The two RPCs that filtered test profiles
-- unconditionally (discover_profiles, get_top_community_members) get the
-- same OR. Only the test-account gate lines change in each function —
-- everything else is the verbatim current definition.

-- ── Environment helper ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_staging_env()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(auth.jwt() ->> 'iss', '') LIKE 'https://ivjkdaylalhsteyyclvl.supabase.co%';
$function$;

-- ── discover_profiles — Discovery / Hockia AI ───────────────────────
CREATE OR REPLACE FUNCTION public.discover_profiles(p_roles text[] DEFAULT NULL::text[], p_positions text[] DEFAULT NULL::text[], p_gender text DEFAULT NULL::text, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_nationality_country_ids integer[] DEFAULT NULL::integer[], p_eu_passport boolean DEFAULT NULL::boolean, p_base_country_ids integer[] DEFAULT NULL::integer[], p_base_location text DEFAULT NULL::text, p_availability text DEFAULT NULL::text, p_min_references integer DEFAULT NULL::integer, p_min_career_entries integer DEFAULT NULL::integer, p_league_ids integer[] DEFAULT NULL::integer[], p_country_ids integer[] DEFAULT NULL::integer[], p_search_text text DEFAULT NULL::text, p_sort_by text DEFAULT 'relevance'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_coach_specializations text[] DEFAULT NULL::text[], p_target_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_eu_country_ids INT[];
  v_total BIGINT;
  v_results JSONB;
  v_effective_category TEXT;
BEGIN
  IF p_eu_passport = true THEN
    SELECT ARRAY_AGG(id) INTO v_eu_country_ids
    FROM countries
    WHERE code IN (
      'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR',
      'DE','GR','HU','IE','IT','LV','LT','LU','MT','NL',
      'PL','PT','RO','SK','SI','ES','SE'
    );
  END IF;

  v_effective_category := COALESCE(
    p_target_category,
    CASE
      WHEN p_gender = 'Men' THEN 'adult_men'
      WHEN p_gender = 'Women' THEN 'adult_women'
      ELSE NULL
    END
  );

  SELECT COUNT(*) INTO v_total
  FROM profiles p
  LEFT JOIN world_clubs wc ON wc.id = p.current_world_club_id
  WHERE p.onboarding_completed = true
    AND (is_staging_env() OR p.is_test_account = false)
    AND p.is_blocked = false
    AND (p_roles IS NULL OR p.role = ANY(p_roles))
    AND (p_positions IS NULL OR p.position = ANY(p_positions) OR p.secondary_position = ANY(p_positions))
    AND (
      v_effective_category IS NULL
      OR CASE p.role
        WHEN 'player' THEN p.playing_category = v_effective_category
        WHEN 'coach'  THEN p.coaching_categories IS NOT NULL
                          AND (v_effective_category = ANY(p.coaching_categories)
                               OR 'any' = ANY(p.coaching_categories))
        WHEN 'umpire' THEN p.umpiring_categories IS NOT NULL
                          AND (v_effective_category = ANY(p.umpiring_categories)
                               OR 'any' = ANY(p.umpiring_categories))
        ELSE TRUE
      END
    )
    AND (p_min_age IS NULL OR p.date_of_birth IS NOT NULL
         AND p.date_of_birth <= CURRENT_DATE - (p_min_age * INTERVAL '1 year'))
    AND (p_max_age IS NULL OR p.date_of_birth IS NOT NULL
         AND p.date_of_birth >= CURRENT_DATE - ((p_max_age + 1) * INTERVAL '1 year'))
    AND (p_nationality_country_ids IS NULL
         OR p.nationality_country_id = ANY(p_nationality_country_ids)
         OR p.nationality2_country_id = ANY(p_nationality_country_ids))
    AND (p_eu_passport IS NULL OR p_eu_passport = false
         OR p.nationality_country_id = ANY(v_eu_country_ids)
         OR p.nationality2_country_id = ANY(v_eu_country_ids))
    AND (p_base_country_ids IS NULL OR p.base_country_id = ANY(p_base_country_ids))
    AND (p_base_location IS NULL
         OR p.base_city ILIKE '%' || p_base_location || '%'
         OR p.base_location ILIKE '%' || p_base_location || '%')
    AND (p_availability IS NULL
         OR (p_availability = 'open_to_play' AND p.open_to_play = true)
         OR (p_availability = 'open_to_coach' AND p.open_to_coach = true)
         OR (p_availability = 'open_to_opportunities' AND p.open_to_opportunities = true))
    AND (p_min_references IS NULL OR p.accepted_reference_count >= p_min_references)
    AND (p_min_career_entries IS NULL OR p.career_entry_count >= p_min_career_entries)
    AND (p_league_ids IS NULL
         OR p.mens_league_id = ANY(p_league_ids)
         OR p.womens_league_id = ANY(p_league_ids))
    AND (p_country_ids IS NULL OR wc.country_id = ANY(p_country_ids))
    AND (p_coach_specializations IS NULL OR p.coach_specialization = ANY(p_coach_specializations))
    AND (p_search_text IS NULL
         OR p.search_vector @@ plainto_tsquery('english', p_search_text));

  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb) INTO v_results
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'username', p.username,
      'avatar_url', p.avatar_url,
      'role', p.role,
      'position', p.position,
      'secondary_position', p.secondary_position,
      'gender', p.gender,
      'playing_category', p.playing_category,
      'coaching_categories', p.coaching_categories,
      'umpiring_categories', p.umpiring_categories,
      'age', CASE
        WHEN p.date_of_birth IS NOT NULL
        THEN EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_of_birth))::INT
        ELSE NULL
      END,
      'nationality_country_id', p.nationality_country_id,
      'nationality2_country_id', p.nationality2_country_id,
      'nationality_name', cn1.nationality_name,
      'nationality2_name', cn2.nationality_name,
      'flag_emoji', cn1.flag_emoji,
      'flag_emoji2', cn2.flag_emoji,
      'base_location', COALESCE(p.base_city, p.base_location),
      'base_country_name', cnb.name,
      'current_club', p.current_club,
      'current_world_club_id', p.current_world_club_id,
      'open_to_play', p.open_to_play,
      'open_to_coach', p.open_to_coach,
      'open_to_opportunities', p.open_to_opportunities,
      'accepted_reference_count', p.accepted_reference_count,
      'career_entry_count', p.career_entry_count,
      'accepted_friend_count', p.accepted_friend_count,
      'last_active_at', p.last_active_at,
      'coach_specialization', p.coach_specialization,
      'coach_specialization_custom', p.coach_specialization_custom
    ) AS row_data
    FROM profiles p
    LEFT JOIN countries cn1 ON cn1.id = p.nationality_country_id
    LEFT JOIN countries cn2 ON cn2.id = p.nationality2_country_id
    LEFT JOIN countries cnb ON cnb.id = p.base_country_id
    LEFT JOIN world_clubs wc ON wc.id = p.current_world_club_id
    WHERE p.onboarding_completed = true
      AND (is_staging_env() OR p.is_test_account = false)
      AND p.is_blocked = false
      AND (p_roles IS NULL OR p.role = ANY(p_roles))
      AND (p_positions IS NULL OR p.position = ANY(p_positions) OR p.secondary_position = ANY(p_positions))
      AND (
        v_effective_category IS NULL
        OR CASE p.role
          WHEN 'player' THEN p.playing_category = v_effective_category
          WHEN 'coach'  THEN p.coaching_categories IS NOT NULL
                            AND (v_effective_category = ANY(p.coaching_categories)
                                 OR 'any' = ANY(p.coaching_categories))
          WHEN 'umpire' THEN p.umpiring_categories IS NOT NULL
                            AND (v_effective_category = ANY(p.umpiring_categories)
                                 OR 'any' = ANY(p.umpiring_categories))
          ELSE TRUE
        END
      )
      AND (p_min_age IS NULL OR p.date_of_birth IS NOT NULL
           AND p.date_of_birth <= CURRENT_DATE - (p_min_age * INTERVAL '1 year'))
      AND (p_max_age IS NULL OR p.date_of_birth IS NOT NULL
           AND p.date_of_birth >= CURRENT_DATE - ((p_max_age + 1) * INTERVAL '1 year'))
      AND (p_nationality_country_ids IS NULL
           OR p.nationality_country_id = ANY(p_nationality_country_ids)
           OR p.nationality2_country_id = ANY(p_nationality_country_ids))
      AND (p_eu_passport IS NULL OR p_eu_passport = false
           OR p.nationality_country_id = ANY(v_eu_country_ids)
           OR p.nationality2_country_id = ANY(v_eu_country_ids))
      AND (p_base_country_ids IS NULL OR p.base_country_id = ANY(p_base_country_ids))
      AND (p_base_location IS NULL
           OR p.base_city ILIKE '%' || p_base_location || '%'
           OR p.base_location ILIKE '%' || p_base_location || '%')
      AND (p_availability IS NULL
           OR (p_availability = 'open_to_play' AND p.open_to_play = true)
           OR (p_availability = 'open_to_coach' AND p.open_to_coach = true)
           OR (p_availability = 'open_to_opportunities' AND p.open_to_opportunities = true))
      AND (p_min_references IS NULL OR p.accepted_reference_count >= p_min_references)
      AND (p_min_career_entries IS NULL OR p.career_entry_count >= p_min_career_entries)
      AND (p_league_ids IS NULL
           OR p.mens_league_id = ANY(p_league_ids)
           OR p.womens_league_id = ANY(p_league_ids))
      AND (p_country_ids IS NULL OR wc.country_id = ANY(p_country_ids))
      AND (p_coach_specializations IS NULL OR p.coach_specialization = ANY(p_coach_specializations))
      AND (p_search_text IS NULL
           OR p.search_vector @@ plainto_tsquery('english', p_search_text))
    ORDER BY
      CASE p_sort_by
        WHEN 'newest' THEN NULL
        WHEN 'most_referenced' THEN NULL
        WHEN 'recently_active' THEN NULL
        ELSE NULL
      END,
      CASE WHEN p_sort_by = 'most_referenced'
        THEN p.accepted_reference_count END DESC NULLS LAST,
      CASE WHEN p_sort_by = 'recently_active'
        THEN p.last_active_at END DESC NULLS LAST,
      CASE WHEN p_sort_by = 'relevance' AND p_search_text IS NOT NULL
        THEN ts_rank(p.search_vector, plainto_tsquery('english', p_search_text)) END DESC NULLS LAST,
      p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'results', v_results,
    'total', v_total,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$function$;

-- ── get_top_community_members — community leaderboard ────────────────
CREATE OR REPLACE FUNCTION public.get_top_community_members(p_role text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, role text, full_name text, username text, avatar_url text, nationality text, nationality_country_id integer, nationality2_country_id integer, base_location text, "position" text, current_club text, current_world_club_id uuid, open_to_play boolean, open_to_coach boolean, open_to_opportunities boolean, is_verified boolean, last_active_at timestamp with time zone, profile_completeness_pct smallint, accepted_reference_count integer, accepted_friend_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.role::TEXT,
    p.full_name,
    p.username,
    p.avatar_url,
    p.nationality,
    p.nationality_country_id,
    p.nationality2_country_id,
    p.base_location,
    p.position,
    p.current_club,
    p.current_world_club_id::UUID,
    p.open_to_play,
    p.open_to_coach,
    p.open_to_opportunities,
    p.is_verified,
    p.last_active_at,
    p.profile_completeness_pct,
    p.accepted_reference_count,
    p.accepted_friend_count
  FROM public.profiles p
  WHERE p.onboarding_completed = TRUE
    AND COALESCE(p.is_blocked, FALSE) = FALSE
    -- Test accounts are excluded from the public leaderboard — except on
    -- staging, where QA needs them surfaced (is_staging_env()).
    AND (is_staging_env() OR COALESCE(p.is_test_account, FALSE) = FALSE)
    AND (p_role IS NULL OR p.role = p_role)
    -- /community proper excludes brands (they're at /marketplace).
    -- Caller can opt into brand ranking by passing p_role='brand'.
    AND (p_role IS NOT NULL OR p.role <> 'brand')
  ORDER BY
    p.profile_completeness_pct DESC,
    p.last_active_at DESC NULLS LAST,
    (p.avatar_url IS NOT NULL) DESC,
    (p.current_club IS NOT NULL) DESC,
    (COALESCE(p.accepted_reference_count, 0) > 0) DESC,
    (COALESCE(p.open_to_play, FALSE)
     OR COALESCE(p.open_to_coach, FALSE)
     OR COALESCE(p.open_to_opportunities, FALSE)) DESC,
    p.id  -- final deterministic tiebreaker so pagination is stable
  LIMIT GREATEST(1, LEAST(p_limit, 100));  -- safety cap
$function$;

-- ── get_brands — marketplace directory ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_brands(p_category text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total INT;
  v_brands JSON;
  v_is_test BOOLEAN;
  v_search TEXT;
BEGIN
  v_search := CASE WHEN p_search IS NOT NULL THEN escape_ilike(p_search) ELSE NULL END;
  v_is_test := is_staging_env() OR COALESCE((SELECT is_test_account FROM profiles WHERE id = auth.uid()), false);

  SELECT COUNT(*) INTO v_total
  FROM public.brands br
  WHERE br.deleted_at IS NULL
    AND (p_category IS NULL OR br.category = p_category)
    AND (v_search IS NULL OR br.name ILIKE '%' || v_search || '%')
    AND (v_is_test OR NOT EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = br.profile_id AND p.is_test_account = true
    ));

  SELECT COALESCE(json_agg(row_to_json(b) ORDER BY b.created_at DESC), '[]'::json)
  INTO v_brands
  FROM (
    SELECT br.id, br.slug, br.name, br.logo_url, br.bio, br.category,
           br.website_url, br.instagram_url,
           COALESCE(p.is_verified, false) AS is_verified,
           br.created_at,
           COALESCE(
             GREATEST(
               (SELECT MAX(created_at) FROM brand_products WHERE brand_id = br.id AND deleted_at IS NULL),
               (SELECT MAX(created_at) FROM brand_posts    WHERE brand_id = br.id AND deleted_at IS NULL)
             ),
             br.created_at
           ) AS last_activity_at
    FROM public.brands br
    LEFT JOIN profiles p ON p.id = br.profile_id
    WHERE br.deleted_at IS NULL
      AND (p_category IS NULL OR br.category = p_category)
      AND (v_search IS NULL OR br.name ILIKE '%' || v_search || '%')
      AND (v_is_test OR NOT EXISTS (
        SELECT 1 FROM profiles pp WHERE pp.id = br.profile_id AND pp.is_test_account = true
      ))
    ORDER BY br.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) b;

  RETURN json_build_object('brands', v_brands, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
END;
$function$;

-- ── get_brand_feed — marketplace feed ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_brand_feed(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB;
  v_total BIGINT;
  v_is_test BOOLEAN;
BEGIN
  v_is_test := is_staging_env() OR COALESCE((SELECT is_test_account FROM profiles WHERE id = auth.uid()), false);

  SELECT
    (SELECT count(*) FROM brand_products bp JOIN brands b ON b.id = bp.brand_id
      WHERE bp.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = b.profile_id AND p.is_test_account = true)))
    + (SELECT count(*) FROM brand_posts bpo JOIN brands b ON b.id = bpo.brand_id
      WHERE bpo.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = b.profile_id AND p.is_test_account = true)))
  INTO v_total;

  SELECT COALESCE(jsonb_agg(sub.item), '[]'::jsonb) INTO v_items
  FROM (
    SELECT item FROM (
      SELECT jsonb_build_object(
        'type','product','id',bp.id,'brand_id',bp.brand_id,'brand_name',b.name,'brand_slug',b.slug,
        'brand_logo_url',b.logo_url,'brand_category',b.category,
        'brand_is_verified', COALESCE(owner.is_verified, false),
        'created_at',bp.created_at,'product_name',bp.name,'product_description',bp.description,
        'product_images',bp.images,'product_external_url',bp.external_url
      ) AS item, bp.created_at AS item_date
      FROM brand_products bp JOIN brands b ON b.id = bp.brand_id
      LEFT JOIN profiles owner ON owner.id = b.profile_id
      WHERE bp.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (SELECT 1 FROM profiles pp WHERE pp.id = b.profile_id AND pp.is_test_account = true))
      UNION ALL
      SELECT jsonb_build_object(
        'type','post','id',bpo.id,'brand_id',bpo.brand_id,'brand_name',b.name,'brand_slug',b.slug,
        'brand_logo_url',b.logo_url,'brand_category',b.category,
        'brand_is_verified', COALESCE(owner.is_verified, false),
        'created_at',bpo.created_at,'post_content',bpo.content,'post_image_url',bpo.image_url
      ) AS item, bpo.created_at AS item_date
      FROM brand_posts bpo JOIN brands b ON b.id = bpo.brand_id
      LEFT JOIN profiles owner ON owner.id = b.profile_id
      WHERE bpo.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (SELECT 1 FROM profiles pp WHERE pp.id = b.profile_id AND pp.is_test_account = true))
    ) feed
    ORDER BY item_date DESC LIMIT p_limit OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
END;
$function$;

-- ── get_home_feed — home / community feed ───────────────────────────
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
         AND hfi.item_type != 'member_joined'
         AND (v_is_test OR hfi.is_test_account = false)
         AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
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
            'created_at', hfi.created_at
          ) AS item_data
        FROM home_feed_items hfi
        WHERE hfi.deleted_at IS NULL
          AND hfi.item_type != 'member_joined'
          AND (v_is_test OR hfi.is_test_account = false)
          AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
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
      AND hfi.item_type != 'member_joined'
      AND (v_is_test OR hfi.is_test_account = false)
      AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
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
        'created_at', hfi.created_at
      )
      ORDER BY hfi.created_at DESC
    ), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT id, item_type, metadata, created_at
      FROM home_feed_items hfi2
      WHERE hfi2.deleted_at IS NULL
        AND hfi2.item_type = p_item_type
        AND hfi2.item_type != 'member_joined'
        AND (v_is_test OR hfi2.is_test_account = false)
        AND (hfi2.author_profile_id IS NULL OR NOT (hfi2.author_profile_id = ANY(v_blocked_ids)))
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

-- ── get_home_feed_new_count — feed "new items" badge ────────────────
CREATE OR REPLACE FUNCTION public.get_home_feed_new_count(p_since timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count INTEGER; v_is_test BOOLEAN; v_user_id UUID := auth.uid();
BEGIN
  SELECT is_staging_env() OR COALESCE(is_test_account, false) INTO v_is_test FROM profiles WHERE id = v_user_id;
  SELECT COUNT(*) INTO v_count FROM (
    SELECT created_at FROM home_feed_items WHERE deleted_at IS NULL AND created_at > p_since AND item_type != 'member_joined' AND (v_is_test OR is_test_account = false)
    UNION ALL
    SELECT up.created_at FROM user_posts up JOIN profiles p ON p.id = up.author_id
    WHERE up.deleted_at IS NULL AND up.created_at > p_since AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id))
  ) combined;
  RETURN v_count;
END;
$function$;

-- ── search_content — global search / Hockia AI ──────────────────────
CREATE OR REPLACE FUNCTION public.search_content(p_query text, p_type text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_test BOOLEAN;
  v_tsquery tsquery;
  v_results JSONB := '[]'::jsonb;
  v_post_results JSONB; v_people_results JSONB; v_club_results JSONB; v_brand_results JSONB; v_opportunity_results JSONB;
  v_post_count BIGINT := 0; v_people_count BIGINT := 0; v_club_count BIGINT := 0; v_brand_count BIGINT := 0; v_opportunity_count BIGINT := 0;
  v_normalized TEXT; v_sanitized TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;
  v_normalized := trim(p_query);
  IF char_length(v_normalized) < 2 THEN
    RETURN jsonb_build_object('results','[]'::jsonb,'total',0,'type_counts',jsonb_build_object('posts',0,'people',0,'clubs',0,'brands',0,'opportunities',0));
  END IF;
  SELECT is_staging_env() OR COALESCE(is_test_account, false) INTO v_is_test FROM profiles WHERE id = v_user_id;
  v_sanitized := regexp_replace(regexp_replace(v_normalized, '[^a-zA-Z0-9\s]', ' ', 'g'), '\s+', ' ', 'g');
  v_sanitized := trim(v_sanitized);
  IF char_length(v_sanitized) < 1 THEN
    RETURN jsonb_build_object('results','[]'::jsonb,'total',0,'type_counts',jsonb_build_object('posts',0,'people',0,'clubs',0,'brands',0,'opportunities',0));
  END IF;
  BEGIN v_tsquery := to_tsquery('english', regexp_replace(v_sanitized, '\s+', ':* & ', 'g') || ':*'); EXCEPTION WHEN OTHERS THEN v_tsquery := plainto_tsquery('english', v_normalized); END;

  IF p_type IS NULL OR p_type = 'posts' THEN
    SELECT COUNT(*) INTO v_post_count FROM user_posts up JOIN profiles p ON p.id = up.author_id
    WHERE up.deleted_at IS NULL AND up.search_vector @@ v_tsquery
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id));
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_post_results FROM (
      SELECT jsonb_build_object('result_type','post','post_id',up.id,'content',up.content,'images',up.images,'author_id',up.author_id,'author_name',COALESCE(b.name,p.full_name),'author_avatar',COALESCE(b.logo_url,p.avatar_url),'author_role',p.role,'like_count',up.like_count,'comment_count',up.comment_count,'post_type',COALESCE(up.post_type,'text'),'created_at',up.created_at) AS row_data, ts_rank(up.search_vector, v_tsquery) AS rank
      FROM user_posts up JOIN profiles p ON p.id = up.author_id LEFT JOIN brands b ON b.profile_id = p.id
      WHERE up.deleted_at IS NULL AND up.search_vector @@ v_tsquery
        AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
        AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id))
      ORDER BY rank DESC, up.created_at DESC
      LIMIT CASE WHEN p_type = 'posts' THEN p_limit ELSE 5 END OFFSET CASE WHEN p_type = 'posts' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type IS NULL OR p_type = 'people' THEN
    SELECT COUNT(*) INTO v_people_count FROM profiles p
    WHERE p.onboarding_completed = true AND (p.search_vector @@ v_tsquery OR p.full_name ILIKE '%' || v_normalized || '%')
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id));
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_people_results FROM (
      SELECT jsonb_build_object('result_type','person','profile_id',p.id,'full_name',COALESCE(b.name,p.full_name),'avatar_url',COALESCE(b.logo_url,p.avatar_url),'role',p.role,'bio',COALESCE(p.bio,p.club_bio),'position',p.position,'base_location',p.base_location,'current_club',p.current_club) AS row_data, ts_rank(p.search_vector, v_tsquery) AS rank
      FROM profiles p LEFT JOIN brands b ON b.profile_id = p.id
      WHERE p.onboarding_completed = true AND (p.search_vector @@ v_tsquery OR p.full_name ILIKE '%' || v_normalized || '%')
        AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
        AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id))
      ORDER BY rank DESC, p.full_name
      LIMIT CASE WHEN p_type = 'people' THEN p_limit ELSE 5 END OFFSET CASE WHEN p_type = 'people' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type IS NULL OR p_type = 'clubs' THEN
    SELECT COUNT(*) INTO v_club_count FROM world_clubs wc WHERE wc.club_name_normalized LIKE '%' || lower(v_normalized) || '%';
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank, club_name), '[]'::jsonb) INTO v_club_results FROM (
      SELECT jsonb_build_object('result_type','club','world_club_id',wc.id,'club_name',wc.club_name,'country_id',wc.country_id,'country_code',c.code,'country_name',c.name,'flag_emoji',c.flag_emoji,'avatar_url',p.avatar_url,'is_claimed',wc.is_claimed,'claimed_profile_id',wc.claimed_profile_id) AS row_data,
      CASE WHEN wc.club_name_normalized LIKE lower(v_normalized) || '%' THEN 0 ELSE 1 END AS rank, wc.club_name
      FROM world_clubs wc JOIN countries c ON c.id = wc.country_id LEFT JOIN profiles p ON p.id = wc.claimed_profile_id
      WHERE wc.club_name_normalized LIKE '%' || lower(v_normalized) || '%'
      ORDER BY rank, wc.club_name
      LIMIT CASE WHEN p_type = 'clubs' THEN p_limit ELSE 5 END OFFSET CASE WHEN p_type = 'clubs' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type IS NULL OR p_type = 'brands' THEN
    SELECT COUNT(*) INTO v_brand_count FROM brands b WHERE b.deleted_at IS NULL AND (b.search_vector @@ v_tsquery OR lower(b.name) LIKE '%' || lower(v_normalized) || '%');
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank, brand_name), '[]'::jsonb) INTO v_brand_results FROM (
      SELECT jsonb_build_object('result_type','brand','brand_id',b.id,'brand_slug',b.slug,'brand_name',b.name,'brand_logo_url',b.logo_url,'brand_category',b.category,'brand_is_verified',COALESCE(p.is_verified,false),'brand_bio',b.bio) AS row_data,
      CASE WHEN lower(b.name) LIKE lower(v_normalized) || '%' THEN 0 ELSE 1 END AS rank, b.name AS brand_name
      FROM brands b LEFT JOIN profiles p ON p.id = b.profile_id
      WHERE b.deleted_at IS NULL AND (b.search_vector @@ v_tsquery OR lower(b.name) LIKE '%' || lower(v_normalized) || '%')
      ORDER BY rank, b.name
      LIMIT CASE WHEN p_type = 'brands' THEN p_limit ELSE 5 END OFFSET CASE WHEN p_type = 'brands' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type IS NULL OR p_type = 'opportunities' THEN
    SELECT COUNT(*) INTO v_opportunity_count FROM opportunities o JOIN profiles cp ON cp.id = o.club_id
    WHERE o.status = 'open' AND o.search_vector @@ v_tsquery AND (v_is_test OR cp.is_test_account IS NULL OR cp.is_test_account = false);
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_opportunity_results FROM (
      SELECT jsonb_build_object('result_type','opportunity','opportunity_id',o.id,'title',o.title,'opportunity_type',o.opportunity_type,'position',o.position,'location_city',o.location_city,'location_country',o.location_country,'club_name',COALESCE(cp.full_name,o.organization_name,'Unknown Club'),'club_avatar_url',cp.avatar_url,'published_at',o.published_at) AS row_data, ts_rank(o.search_vector, v_tsquery) AS rank
      FROM opportunities o JOIN profiles cp ON cp.id = o.club_id
      WHERE o.status = 'open' AND o.search_vector @@ v_tsquery AND (v_is_test OR cp.is_test_account IS NULL OR cp.is_test_account = false)
      ORDER BY rank DESC, o.published_at DESC NULLS LAST
      LIMIT CASE WHEN p_type = 'opportunities' THEN p_limit ELSE 5 END OFFSET CASE WHEN p_type = 'opportunities' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type = 'posts' THEN v_results := COALESCE(v_post_results, '[]'::jsonb);
  ELSIF p_type = 'people' THEN v_results := COALESCE(v_people_results, '[]'::jsonb);
  ELSIF p_type = 'clubs' THEN v_results := COALESCE(v_club_results, '[]'::jsonb);
  ELSIF p_type = 'brands' THEN v_results := COALESCE(v_brand_results, '[]'::jsonb);
  ELSIF p_type = 'opportunities' THEN v_results := COALESCE(v_opportunity_results, '[]'::jsonb);
  ELSE v_results := COALESCE(v_post_results, '[]'::jsonb) || COALESCE(v_people_results, '[]'::jsonb) || COALESCE(v_club_results, '[]'::jsonb) || COALESCE(v_brand_results, '[]'::jsonb) || COALESCE(v_opportunity_results, '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object('results', v_results, 'total', v_post_count + v_people_count + v_club_count + v_brand_count + v_opportunity_count, 'type_counts', jsonb_build_object('posts',v_post_count,'people',v_people_count,'clubs',v_club_count,'brands',v_brand_count,'opportunities',v_opportunity_count));
END;
$function$;
