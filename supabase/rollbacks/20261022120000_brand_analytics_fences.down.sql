-- Rollback for 20261022120000_brand_analytics_fences.sql: the body from
-- 202603030100_brand_ambassadors_bilateral.sql (no fences).

CREATE OR REPLACE FUNCTION public.get_my_brand_analytics(
  p_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_role TEXT;
  v_brand_id UUID;
  v_profile_id UUID;
  v_profile_views BIGINT := 0;
  v_profile_views_previous BIGINT := 0;
  v_follower_count INT := 0;
  v_product_count BIGINT := 0;
  v_post_count BIGINT := 0;
  v_ambassador_count BIGINT := 0;
  v_period_start TIMESTAMPTZ;
  v_previous_start TIMESTAMPTZ;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT role INTO v_user_role FROM profiles WHERE id = v_user_id;
  IF v_user_role != 'brand' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only brand users can view brand analytics');
  END IF;

  SELECT id, profile_id INTO v_brand_id, v_profile_id
  FROM brands WHERE profile_id = v_user_id AND deleted_at IS NULL;

  IF v_brand_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Brand not found');
  END IF;

  v_period_start := now() - (p_days || ' days')::interval;
  v_previous_start := v_period_start - (p_days || ' days')::interval;

  SELECT COUNT(*) INTO v_profile_views
  FROM events
  WHERE event_name = 'profile_view'
    AND entity_type = 'profile'
    AND entity_id = v_profile_id
    AND created_at >= v_period_start;

  SELECT COUNT(*) INTO v_profile_views_previous
  FROM events
  WHERE event_name = 'profile_view'
    AND entity_type = 'profile'
    AND entity_id = v_profile_id
    AND created_at >= v_previous_start
    AND created_at < v_period_start;

  SELECT COALESCE(b.follower_count, 0) INTO v_follower_count
  FROM brands b WHERE b.id = v_brand_id;

  SELECT COUNT(*) INTO v_product_count
  FROM brand_products WHERE brand_id = v_brand_id AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_post_count
  FROM brand_posts WHERE brand_id = v_brand_id AND deleted_at IS NULL;

  -- Ambassador count (accepted only)
  SELECT COUNT(*) INTO v_ambassador_count
  FROM brand_ambassadors WHERE brand_id = v_brand_id AND status = 'accepted';

  RETURN jsonb_build_object(
    'success', true,
    'profile_views', v_profile_views,
    'profile_views_previous', v_profile_views_previous,
    'follower_count', v_follower_count,
    'product_count', v_product_count,
    'post_count', v_post_count,
    'ambassador_count', v_ambassador_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_brand_analytics(integer) TO authenticated;
