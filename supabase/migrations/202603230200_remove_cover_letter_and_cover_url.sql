-- Remove unused dead features:
-- 1. cover_letter from opportunity_applications (never collected in UI)
-- 2. cover_url from brands (no upload UI exists)

-- ============================================================================
-- 1. Update admin_get_vacancy_applicants to remove cover_letter from RETURNS
--    Must DROP first because CREATE OR REPLACE cannot change return type.
-- ============================================================================
DROP FUNCTION IF EXISTS public.admin_get_vacancy_applicants(UUID, application_status, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.admin_get_vacancy_applicants(
  p_vacancy_id UUID,
  p_status application_status DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  application_id UUID,
  player_id UUID,
  player_name TEXT,
  player_email TEXT,
  nationality TEXT,
  "position" TEXT,
  avatar_url TEXT,
  highlight_video_url TEXT,
  status application_status,
  applied_at TIMESTAMPTZ,
  onboarding_completed BOOLEAN,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT COUNT(*)
  INTO v_total
  FROM opportunity_applications oa
  WHERE oa.opportunity_id = p_vacancy_id
    AND (p_status IS NULL OR oa.status = p_status);

  RETURN QUERY
  SELECT
    oa.id as application_id,
    oa.applicant_id as player_id,
    p.full_name as player_name,
    p.email as player_email,
    COALESCE(c.name, p.nationality) as nationality,
    p."position",
    p.avatar_url,
    p.highlight_video_url,
    oa.status,
    oa.applied_at,
    p.onboarding_completed,
    v_total
  FROM opportunity_applications oa
  JOIN profiles p ON p.id = oa.applicant_id
  LEFT JOIN countries c ON c.id = p.nationality_country_id
  WHERE oa.opportunity_id = p_vacancy_id
    AND (p_status IS NULL OR oa.status = p_status)
  ORDER BY oa.applied_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_vacancy_applicants TO authenticated;

-- ============================================================================
-- 2. Update brand RPCs to remove cover_url
-- ============================================================================

-- get_brand_by_slug: remove cover_url from SELECT
CREATE OR REPLACE FUNCTION public.get_brand_by_slug(p_slug TEXT)
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
        br.is_verified,
        br.created_at,
        br.updated_at
      FROM public.brands br
      WHERE br.slug = p_slug
        AND br.deleted_at IS NULL
    ) b
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_brand_by_slug TO anon, authenticated;

-- get_my_brand: remove cover_url from SELECT
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
        br.is_verified,
        br.created_at,
        br.updated_at
      FROM public.brands br
      WHERE br.profile_id = auth.uid()
        AND br.deleted_at IS NULL
    ) b
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_brand TO authenticated;

-- get_brands: remove cover_url from SELECT
CREATE OR REPLACE FUNCTION public.get_brands(
  p_category TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
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
      br.is_verified,
      br.created_at,
      COALESCE(
        GREATEST(
          (SELECT MAX(created_at) FROM brand_products WHERE brand_id = br.id AND deleted_at IS NULL),
          (SELECT MAX(created_at) FROM brand_posts WHERE brand_id = br.id AND deleted_at IS NULL)
        ),
        br.created_at
      ) AS last_activity_at
    FROM public.brands br
    WHERE br.deleted_at IS NULL
      AND (p_category IS NULL OR br.category = p_category)
      AND (v_search IS NULL OR br.name ILIKE '%' || v_search || '%')
      AND (v_is_test OR NOT EXISTS (
        SELECT 1 FROM profiles p WHERE p.id = br.profile_id AND p.is_test_account = true
      ))
    ORDER BY br.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) b;

  RETURN json_build_object(
    'brands', v_brands,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_brands(TEXT, TEXT, INT, INT) TO anon, authenticated;

-- update_brand: remove p_cover_url parameter
-- Must DROP old signature first (different param count = different overload)
DROP FUNCTION IF EXISTS public.update_brand(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.update_brand(
  p_name TEXT DEFAULT NULL,
  p_bio TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_website_url TEXT DEFAULT NULL,
  p_instagram_url TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_id UUID;
BEGIN
  SELECT id INTO v_brand_id
  FROM public.brands
  WHERE profile_id = auth.uid()
    AND deleted_at IS NULL;

  IF v_brand_id IS NULL THEN
    RAISE EXCEPTION 'Brand not found';
  END IF;

  IF p_category IS NOT NULL AND p_category NOT IN ('equipment', 'apparel', 'accessories', 'nutrition', 'services', 'technology', 'other') THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;

  UPDATE public.brands
  SET
    name = COALESCE(nullif(trim(p_name), ''), name),
    bio = CASE WHEN p_bio IS NOT NULL THEN nullif(trim(p_bio), '') ELSE bio END,
    logo_url = CASE WHEN p_logo_url IS NOT NULL THEN nullif(trim(p_logo_url), '') ELSE logo_url END,
    website_url = CASE WHEN p_website_url IS NOT NULL THEN nullif(trim(p_website_url), '') ELSE website_url END,
    instagram_url = CASE WHEN p_instagram_url IS NOT NULL THEN nullif(trim(p_instagram_url), '') ELSE instagram_url END,
    category = COALESCE(p_category, category)
  WHERE id = v_brand_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_brand TO authenticated;

-- ============================================================================
-- 3. Drop the columns (after RPCs updated so no function references remain)
-- ============================================================================
ALTER TABLE public.opportunity_applications DROP COLUMN IF EXISTS cover_letter;
ALTER TABLE public.brands DROP COLUMN IF EXISTS cover_url;
