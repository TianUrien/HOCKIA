-- ============================================================================
-- M-31: Escape ILIKE wildcards in brand search
-- ============================================================================
-- Prevents data enumeration by escaping %, _, and \ in search input
-- before passing to ILIKE.
-- ============================================================================

SET search_path = public;

-- Helper: escape ILIKE special characters
CREATE OR REPLACE FUNCTION public.escape_ilike(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT replace(replace(replace(input, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- ============================================================================
-- Patched get_brands — uses escape_ilike on p_search
-- ============================================================================
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
  -- Escape ILIKE wildcards
  v_search := CASE WHEN p_search IS NOT NULL THEN escape_ilike(p_search) ELSE NULL END;

  -- Check if the current user is a test account (they see everything)
  v_is_test := COALESCE(
    (SELECT is_test_account FROM profiles WHERE id = auth.uid()),
    false
  );

  -- Get total count
  SELECT COUNT(*) INTO v_total
  FROM public.brands br
  WHERE br.deleted_at IS NULL
    AND (p_category IS NULL OR br.category = p_category)
    AND (v_search IS NULL OR br.name ILIKE '%' || v_search || '%')
    AND (v_is_test OR NOT EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = br.profile_id AND p.is_test_account = true
    ));

  -- Get brands with last activity date
  SELECT COALESCE(json_agg(row_to_json(b) ORDER BY b.created_at DESC), '[]'::json)
  INTO v_brands
  FROM (
    SELECT
      br.id,
      br.slug,
      br.name,
      br.logo_url,
      br.cover_url,
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
GRANT EXECUTE ON FUNCTION public.escape_ilike(TEXT) TO anon, authenticated;
