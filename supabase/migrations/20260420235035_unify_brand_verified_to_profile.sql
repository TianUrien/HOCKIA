-- =========================================================================
-- Unify brand verification onto profiles.is_verified
-- =========================================================================
-- brands.is_verified is dropped; all reads now source from the owning
-- profile via JOIN. admin_set_profile_verified (shipped in the prior PR)
-- is already the single write path. Public RPC output shapes are preserved
-- so older iOS builds keep working — only the underlying source changes.
--
-- Data state at cut-over: 0 brands verified, 0 divergence — verified via
-- direct inspection before writing this. Backfill below is defensive only.
-- =========================================================================

-- 1. Defensive backfill: mirror any non-false brand verification onto the
--    owning profile BEFORE we drop the column. No-op when data is already
--    in sync.
UPDATE public.profiles p
   SET is_verified = true,
       verified_at = COALESCE(p.verified_at, now()),
       verified_by = COALESCE(p.verified_by, p.id),
       updated_at  = now()
  FROM public.brands b
 WHERE b.profile_id = p.id
   AND b.is_verified = true
   AND p.is_verified = false
   AND b.deleted_at IS NULL;

-- 2. Rewrite RPCs to source is_verified from profiles. Output shapes are
--    unchanged so any existing iOS build continues to render correctly.

-- ── get_brands ──
CREATE OR REPLACE FUNCTION public.get_brands(
  p_category TEXT DEFAULT NULL,
  p_search   TEXT DEFAULT NULL,
  p_limit    INTEGER DEFAULT 20,
  p_offset   INTEGER DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_brands JSON;
  v_is_test BOOLEAN;
  v_search TEXT;
BEGIN
  v_search := CASE WHEN p_search IS NOT NULL THEN escape_ilike(p_search) ELSE NULL END;

  v_is_test := COALESCE(
    (SELECT is_test_account FROM profiles WHERE id = auth.uid()),
    false
  );

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
    SELECT
      br.id,
      br.slug,
      br.name,
      br.logo_url,
      br.bio,
      br.category,
      br.website_url,
      br.instagram_url,
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
    LIMIT p_limit
    OFFSET p_offset
  ) b;

  RETURN json_build_object(
    'brands', v_brands,
    'total',  v_total,
    'limit',  p_limit,
    'offset', p_offset
  );
END;
$$;

-- ── get_my_brand ──
CREATE OR REPLACE FUNCTION public.get_my_brand()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT row_to_json(b)
    FROM (
      SELECT
        br.id,
        br.profile_id,
        br.slug,
        br.name,
        br.logo_url,
        br.bio,
        br.website_url,
        br.instagram_url,
        br.category,
        COALESCE(p.is_verified, false) AS is_verified,
        br.created_at,
        br.updated_at
      FROM public.brands br
      LEFT JOIN profiles p ON p.id = br.profile_id
      WHERE br.profile_id = auth.uid()
        AND br.deleted_at IS NULL
    ) b
  );
END;
$$;

-- ── get_brand_feed ──
CREATE OR REPLACE FUNCTION public.get_brand_feed(p_limit INTEGER DEFAULT 20, p_offset INTEGER DEFAULT 0)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB;
  v_total BIGINT;
  v_is_test BOOLEAN;
BEGIN
  v_is_test := COALESCE(
    (SELECT is_test_account FROM profiles WHERE id = auth.uid()),
    false
  );

  SELECT
    (SELECT count(*)
       FROM brand_products bp
       JOIN brands b ON b.id = bp.brand_id
      WHERE bp.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (
          SELECT 1 FROM profiles p WHERE p.id = b.profile_id AND p.is_test_account = true
        ))
    )
    +
    (SELECT count(*)
       FROM brand_posts bpo
       JOIN brands b ON b.id = bpo.brand_id
      WHERE bpo.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (
          SELECT 1 FROM profiles p WHERE p.id = b.profile_id AND p.is_test_account = true
        ))
    )
  INTO v_total;

  SELECT COALESCE(jsonb_agg(sub.item), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT item
    FROM (
      -- Products
      SELECT
        jsonb_build_object(
          'type', 'product',
          'id', bp.id,
          'brand_id', bp.brand_id,
          'brand_name', b.name,
          'brand_slug', b.slug,
          'brand_logo_url', b.logo_url,
          'brand_category', b.category,
          'brand_is_verified', COALESCE(owner.is_verified, false),
          'created_at', bp.created_at,
          'product_name', bp.name,
          'product_description', bp.description,
          'product_images', bp.images,
          'product_external_url', bp.external_url
        ) AS item,
        bp.created_at AS item_date
      FROM brand_products bp
      JOIN brands b ON b.id = bp.brand_id
      LEFT JOIN profiles owner ON owner.id = b.profile_id
      WHERE bp.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (
          SELECT 1 FROM profiles pp WHERE pp.id = b.profile_id AND pp.is_test_account = true
        ))

      UNION ALL

      -- Posts
      SELECT
        jsonb_build_object(
          'type', 'post',
          'id', bpo.id,
          'brand_id', bpo.brand_id,
          'brand_name', b.name,
          'brand_slug', b.slug,
          'brand_logo_url', b.logo_url,
          'brand_category', b.category,
          'brand_is_verified', COALESCE(owner.is_verified, false),
          'created_at', bpo.created_at,
          'post_content', bpo.content,
          'post_image_url', bpo.image_url
        ) AS item,
        bpo.created_at AS item_date
      FROM brand_posts bpo
      JOIN brands b ON b.id = bpo.brand_id
      LEFT JOIN profiles owner ON owner.id = b.profile_id
      WHERE bpo.deleted_at IS NULL AND b.deleted_at IS NULL
        AND (v_is_test OR NOT EXISTS (
          SELECT 1 FROM profiles pp WHERE pp.id = b.profile_id AND pp.is_test_account = true
        ))
    ) feed
    ORDER BY item_date DESC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'items',  v_items,
    'total',  v_total,
    'limit',  p_limit,
    'offset', p_offset
  );
END;
$$;

-- ── admin_get_brand_summary ──
CREATE OR REPLACE FUNCTION public.admin_get_brand_summary()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT json_build_object(
    'total_brands', (
      SELECT COUNT(*) FROM brands WHERE deleted_at IS NULL
    ),
    'verified_brands', (
      SELECT COUNT(*)
        FROM brands b
        JOIN profiles p ON p.id = b.profile_id
       WHERE p.is_verified = true AND b.deleted_at IS NULL
    ),
    'brands_with_products', (
      SELECT COUNT(DISTINCT bp.brand_id) FROM brand_products bp
      JOIN brands b ON b.id = bp.brand_id
      WHERE bp.deleted_at IS NULL AND b.deleted_at IS NULL
    ),
    'brands_with_posts', (
      SELECT COUNT(DISTINCT bpost.brand_id) FROM brand_posts bpost
      JOIN brands b ON b.id = bpost.brand_id
      WHERE bpost.deleted_at IS NULL AND b.deleted_at IS NULL
    ),
    'total_products', (
      SELECT COUNT(*) FROM brand_products WHERE deleted_at IS NULL
    ),
    'total_posts', (
      SELECT COUNT(*) FROM brand_posts WHERE deleted_at IS NULL
    ),
    'brands_7d', (
      SELECT COUNT(*) FROM brands
      WHERE created_at > now() - interval '7 days' AND deleted_at IS NULL
    ),
    'brands_30d', (
      SELECT COUNT(*) FROM brands
      WHERE created_at > now() - interval '30 days' AND deleted_at IS NULL
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ── admin_get_brand_activity ──
-- TABLE return-shape is unchanged; only the source of is_verified moves.
CREATE OR REPLACE FUNCTION public.admin_get_brand_activity(
  p_days   INTEGER DEFAULT 30,
  p_limit  INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  brand_id UUID,
  brand_name TEXT,
  logo_url TEXT,
  category TEXT,
  slug TEXT,
  is_verified BOOLEAN,
  product_count BIGINT,
  post_count BIGINT,
  last_activity_at TIMESTAMPTZ,
  onboarding_completed BOOLEAN,
  created_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_date_filter TIMESTAMPTZ;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  v_date_filter := CASE
    WHEN p_days IS NULL THEN '-infinity'::TIMESTAMPTZ
    ELSE now() - (p_days || ' days')::INTERVAL
  END;

  SELECT COUNT(*)
  INTO v_total
  FROM brands b
  WHERE b.deleted_at IS NULL
    AND b.created_at > v_date_filter;

  RETURN QUERY
  SELECT
    b.id AS brand_id,
    b.name AS brand_name,
    b.logo_url,
    b.category,
    b.slug,
    COALESCE(p.is_verified, false) AS is_verified,
    COALESCE(bp_count.cnt, 0)::BIGINT AS product_count,
    COALESCE(bpost_count.cnt, 0)::BIGINT AS post_count,
    GREATEST(
      b.updated_at,
      bp_count.last_at,
      bpost_count.last_at
    ) AS last_activity_at,
    COALESCE(p.onboarding_completed, false) AS onboarding_completed,
    b.created_at,
    v_total
  FROM brands b
  LEFT JOIN profiles p ON p.id = b.profile_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt, MAX(bp.created_at) AS last_at
    FROM brand_products bp
    WHERE bp.brand_id = b.id AND bp.deleted_at IS NULL
  ) bp_count ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt, MAX(bpost.created_at) AS last_at
    FROM brand_posts bpost
    WHERE bpost.brand_id = b.id AND bpost.deleted_at IS NULL
  ) bpost_count ON true
  WHERE b.deleted_at IS NULL
    AND b.created_at > v_date_filter
  ORDER BY (COALESCE(bp_count.cnt, 0) + COALESCE(bpost_count.cnt, 0)) DESC, b.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── generate_brand_post_feed_item (trigger) ──
CREATE OR REPLACE FUNCTION public.generate_brand_post_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand RECORD;
BEGIN
  SELECT
    b.id, b.name, b.slug, b.logo_url, b.category, b.deleted_at,
    COALESCE(p.is_verified, false) AS is_verified,
    p.is_test_account
  INTO v_brand
  FROM brands b
  JOIN profiles p ON p.id = b.profile_id
  WHERE b.id = NEW.brand_id;

  IF v_brand.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO home_feed_items (item_type, source_id, source_type, is_test_account, metadata)
  VALUES (
    'brand_post',
    NEW.id,
    'brand_post',
    COALESCE(v_brand.is_test_account, false),
    jsonb_build_object(
      'brand_id', v_brand.id,
      'brand_name', v_brand.name,
      'brand_slug', v_brand.slug,
      'brand_logo_url', v_brand.logo_url,
      'brand_category', v_brand.category,
      'brand_is_verified', v_brand.is_verified,
      'post_id', NEW.id,
      'post_content', NEW.content,
      'post_image_url', NEW.image_url
    )
  )
  ON CONFLICT (item_type, source_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── generate_brand_product_feed_item (trigger) ──
CREATE OR REPLACE FUNCTION public.generate_brand_product_feed_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand RECORD;
BEGIN
  SELECT
    b.id, b.name, b.slug, b.logo_url, b.category, b.deleted_at,
    COALESCE(p.is_verified, false) AS is_verified,
    p.is_test_account
  INTO v_brand
  FROM brands b
  JOIN profiles p ON p.id = b.profile_id
  WHERE b.id = NEW.brand_id;

  IF v_brand.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO home_feed_items (item_type, source_id, source_type, is_test_account, metadata)
  VALUES (
    'brand_product',
    NEW.id,
    'brand_product',
    COALESCE(v_brand.is_test_account, false),
    jsonb_build_object(
      'brand_id', v_brand.id,
      'brand_name', v_brand.name,
      'brand_slug', v_brand.slug,
      'brand_logo_url', v_brand.logo_url,
      'brand_category', v_brand.category,
      'brand_is_verified', v_brand.is_verified,
      'product_id', NEW.id,
      'product_name', NEW.name,
      'product_description', NEW.description,
      'product_images', NEW.images,
      'product_external_url', NEW.external_url
    )
  )
  ON CONFLICT (item_type, source_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ── search_content: brands section only (rest unchanged) ──
-- Preserved by re-creating the full function body since CREATE OR REPLACE
-- requires matching signature. Only the brand results sub-query now JOINs
-- to profiles for is_verified.
CREATE OR REPLACE FUNCTION public.search_content(
  p_query  TEXT,
  p_type   TEXT DEFAULT NULL,
  p_limit  INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_test BOOLEAN;
  v_tsquery tsquery;
  v_results JSONB := '[]'::jsonb;
  v_post_results JSONB;
  v_people_results JSONB;
  v_club_results JSONB;
  v_brand_results JSONB;
  v_opportunity_results JSONB;
  v_post_count BIGINT := 0;
  v_people_count BIGINT := 0;
  v_club_count BIGINT := 0;
  v_brand_count BIGINT := 0;
  v_opportunity_count BIGINT := 0;
  v_normalized TEXT;
  v_sanitized TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_normalized := trim(p_query);
  IF char_length(v_normalized) < 2 THEN
    RETURN jsonb_build_object(
      'results', '[]'::jsonb, 'total', 0,
      'type_counts', jsonb_build_object('posts', 0, 'people', 0, 'clubs', 0, 'brands', 0, 'opportunities', 0)
    );
  END IF;

  SELECT COALESCE(is_test_account, false) INTO v_is_test FROM profiles WHERE id = v_user_id;

  v_sanitized := regexp_replace(regexp_replace(v_normalized, '[^a-zA-Z0-9\s]', ' ', 'g'), '\s+', ' ', 'g');
  v_sanitized := trim(v_sanitized);

  IF char_length(v_sanitized) < 1 THEN
    RETURN jsonb_build_object(
      'results', '[]'::jsonb, 'total', 0,
      'type_counts', jsonb_build_object('posts', 0, 'people', 0, 'clubs', 0, 'brands', 0, 'opportunities', 0)
    );
  END IF;

  BEGIN
    v_tsquery := to_tsquery('english', regexp_replace(v_sanitized, '\s+', ':* & ', 'g') || ':*');
  EXCEPTION WHEN OTHERS THEN
    v_tsquery := plainto_tsquery('english', v_normalized);
  END;

  -- POSTS
  IF p_type IS NULL OR p_type = 'posts' THEN
    SELECT COUNT(*) INTO v_post_count
    FROM user_posts up
    JOIN profiles p ON p.id = up.author_id
    WHERE up.deleted_at IS NULL AND up.search_vector @@ v_tsquery
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id));

    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_post_results
    FROM (
      SELECT jsonb_build_object(
        'result_type', 'post', 'post_id', up.id, 'content', up.content, 'images', up.images,
        'author_id', up.author_id, 'author_name', COALESCE(b.name, p.full_name),
        'author_avatar', COALESCE(b.logo_url, p.avatar_url), 'author_role', p.role,
        'like_count', up.like_count, 'comment_count', up.comment_count,
        'post_type', COALESCE(up.post_type, 'text'), 'created_at', up.created_at
      ) AS row_data, ts_rank(up.search_vector, v_tsquery) AS rank
      FROM user_posts up
      JOIN profiles p ON p.id = up.author_id
      LEFT JOIN brands b ON b.profile_id = p.id
      WHERE up.deleted_at IS NULL AND up.search_vector @@ v_tsquery
        AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
        AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id))
      ORDER BY rank DESC, up.created_at DESC
      LIMIT CASE WHEN p_type = 'posts' THEN p_limit ELSE 5 END
      OFFSET CASE WHEN p_type = 'posts' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  -- PEOPLE
  IF p_type IS NULL OR p_type = 'people' THEN
    SELECT COUNT(*) INTO v_people_count
    FROM profiles p
    WHERE p.onboarding_completed = true
      AND (p.search_vector @@ v_tsquery OR p.full_name ILIKE '%' || v_normalized || '%')
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id));

    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_people_results
    FROM (
      SELECT jsonb_build_object(
        'result_type', 'person', 'profile_id', p.id, 'full_name', COALESCE(b.name, p.full_name),
        'avatar_url', COALESCE(b.logo_url, p.avatar_url), 'role', p.role,
        'bio', COALESCE(p.bio, p.club_bio), 'position', p.position,
        'base_location', p.base_location, 'current_club', p.current_club
      ) AS row_data, ts_rank(p.search_vector, v_tsquery) AS rank
      FROM profiles p
      LEFT JOIN brands b ON b.profile_id = p.id
      WHERE p.onboarding_completed = true
        AND (p.search_vector @@ v_tsquery OR p.full_name ILIKE '%' || v_normalized || '%')
        AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
        AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id))
      ORDER BY rank DESC, p.full_name
      LIMIT CASE WHEN p_type = 'people' THEN p_limit ELSE 5 END
      OFFSET CASE WHEN p_type = 'people' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  -- CLUBS
  IF p_type IS NULL OR p_type = 'clubs' THEN
    SELECT COUNT(*) INTO v_club_count FROM world_clubs wc WHERE wc.club_name_normalized LIKE '%' || lower(v_normalized) || '%';
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank, club_name), '[]'::jsonb) INTO v_club_results
    FROM (
      SELECT jsonb_build_object(
        'result_type', 'club', 'world_club_id', wc.id, 'club_name', wc.club_name,
        'country_id', wc.country_id, 'country_code', c.code, 'country_name', c.name,
        'flag_emoji', c.flag_emoji, 'avatar_url', p.avatar_url,
        'is_claimed', wc.is_claimed, 'claimed_profile_id', wc.claimed_profile_id
      ) AS row_data,
      CASE WHEN wc.club_name_normalized LIKE lower(v_normalized) || '%' THEN 0 ELSE 1 END AS rank, wc.club_name
      FROM world_clubs wc
      JOIN countries c ON c.id = wc.country_id
      LEFT JOIN profiles p ON p.id = wc.claimed_profile_id
      WHERE wc.club_name_normalized LIKE '%' || lower(v_normalized) || '%'
      ORDER BY rank, wc.club_name
      LIMIT CASE WHEN p_type = 'clubs' THEN p_limit ELSE 5 END
      OFFSET CASE WHEN p_type = 'clubs' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  -- BRANDS — is_verified now sourced from profiles
  IF p_type IS NULL OR p_type = 'brands' THEN
    SELECT COUNT(*) INTO v_brand_count
    FROM brands b
    WHERE b.deleted_at IS NULL
      AND (b.search_vector @@ v_tsquery OR lower(b.name) LIKE '%' || lower(v_normalized) || '%');

    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank, brand_name), '[]'::jsonb) INTO v_brand_results
    FROM (
      SELECT jsonb_build_object(
        'result_type', 'brand', 'brand_id', b.id, 'brand_slug', b.slug, 'brand_name', b.name,
        'brand_logo_url', b.logo_url, 'brand_category', b.category,
        'brand_is_verified', COALESCE(p.is_verified, false), 'brand_bio', b.bio
      ) AS row_data,
      CASE WHEN lower(b.name) LIKE lower(v_normalized) || '%' THEN 0 ELSE 1 END AS rank,
      b.name AS brand_name
      FROM brands b
      LEFT JOIN profiles p ON p.id = b.profile_id
      WHERE b.deleted_at IS NULL
        AND (b.search_vector @@ v_tsquery OR lower(b.name) LIKE '%' || lower(v_normalized) || '%')
      ORDER BY rank, b.name
      LIMIT CASE WHEN p_type = 'brands' THEN p_limit ELSE 5 END
      OFFSET CASE WHEN p_type = 'brands' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  -- OPPORTUNITIES
  IF p_type IS NULL OR p_type = 'opportunities' THEN
    SELECT COUNT(*) INTO v_opportunity_count FROM opportunities o JOIN profiles cp ON cp.id = o.club_id
    WHERE o.status = 'open' AND o.search_vector @@ v_tsquery AND (v_is_test OR cp.is_test_account IS NULL OR cp.is_test_account = false);
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_opportunity_results
    FROM (
      SELECT jsonb_build_object(
        'result_type', 'opportunity', 'opportunity_id', o.id, 'title', o.title,
        'opportunity_type', o.opportunity_type, 'position', o.position,
        'location_city', o.location_city, 'location_country', o.location_country,
        'club_name', COALESCE(cp.full_name, o.organization_name, 'Unknown Club'),
        'club_avatar_url', cp.avatar_url, 'published_at', o.published_at
      ) AS row_data, ts_rank(o.search_vector, v_tsquery) AS rank
      FROM opportunities o JOIN profiles cp ON cp.id = o.club_id
      WHERE o.status = 'open' AND o.search_vector @@ v_tsquery AND (v_is_test OR cp.is_test_account IS NULL OR cp.is_test_account = false)
      ORDER BY rank DESC, o.published_at DESC NULLS LAST
      LIMIT CASE WHEN p_type = 'opportunities' THEN p_limit ELSE 5 END
      OFFSET CASE WHEN p_type = 'opportunities' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type = 'posts' THEN v_results := COALESCE(v_post_results, '[]'::jsonb);
  ELSIF p_type = 'people' THEN v_results := COALESCE(v_people_results, '[]'::jsonb);
  ELSIF p_type = 'clubs' THEN v_results := COALESCE(v_club_results, '[]'::jsonb);
  ELSIF p_type = 'brands' THEN v_results := COALESCE(v_brand_results, '[]'::jsonb);
  ELSIF p_type = 'opportunities' THEN v_results := COALESCE(v_opportunity_results, '[]'::jsonb);
  ELSE
    v_results := COALESCE(v_post_results, '[]'::jsonb)
              || COALESCE(v_people_results, '[]'::jsonb)
              || COALESCE(v_club_results, '[]'::jsonb)
              || COALESCE(v_brand_results, '[]'::jsonb)
              || COALESCE(v_opportunity_results, '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'results', v_results,
    'total',   v_post_count + v_people_count + v_club_count + v_brand_count + v_opportunity_count,
    'type_counts', jsonb_build_object('posts', v_post_count, 'people', v_people_count, 'clubs', v_club_count, 'brands', v_brand_count, 'opportunities', v_opportunity_count)
  );
END;
$$;

-- 3. Finally, drop the column. Every reader has been rewired above.
ALTER TABLE public.brands DROP COLUMN IF EXISTS is_verified;
