-- Brand analytics: count real views and visible ambassadors only (2026-10-22).
--
-- get_my_brand_analytics (latest body: 202603030100_brand_ambassadors_bilateral.sql)
-- counted every profile_view event on the brand profile and every accepted
-- ambassador, so a brand's numbers included its own views, test accounts,
-- anonymous rows, and hidden (banned / frozen-minor) members, and blocked
-- pairs. CLAUDE.md: "when fencing a surface that also COUNTS people ...
-- exclude hidden rows from the count too". This applies the same fences as
-- get_my_profile_view_stats (members' own view stats) to both view counts
-- and the hidden-profile fence to the ambassador count. Response shape and
-- signature unchanged; follower_count stays the stored counter.
--
-- Rollback: supabase/rollbacks/20261022120000_brand_analytics_fences.down.sql
-- Probe:    supabase/tests/security/brand_analytics_fences.probe.sql (staging, rolled back)

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

  -- Real views only: signed-in viewers, never the brand itself, never test
  -- accounts, hidden (banned / frozen) viewers or a blocked pair.
  SELECT COUNT(*) INTO v_profile_views
  FROM events e
  LEFT JOIN profiles p ON p.id = e.user_id
  WHERE e.event_name = 'profile_view'
    AND e.entity_type = 'profile'
    AND e.entity_id = v_profile_id
    AND e.created_at >= v_period_start
    AND e.user_id IS NOT NULL
    AND e.user_id <> v_profile_id
    AND COALESCE(p.is_test_account, false) = false
    -- Hidden-profile fence (parity with get_my_profile_view_stats)
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND NOT public.is_blocked_pair(v_profile_id, e.user_id);

  SELECT COUNT(*) INTO v_profile_views_previous
  FROM events e
  LEFT JOIN profiles p ON p.id = e.user_id
  WHERE e.event_name = 'profile_view'
    AND e.entity_type = 'profile'
    AND e.entity_id = v_profile_id
    AND e.created_at >= v_previous_start
    AND e.created_at < v_period_start
    AND e.user_id IS NOT NULL
    AND e.user_id <> v_profile_id
    AND COALESCE(p.is_test_account, false) = false
    -- Hidden-profile fence (parity with get_my_profile_view_stats)
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND NOT public.is_blocked_pair(v_profile_id, e.user_id);

  SELECT COALESCE(b.follower_count, 0) INTO v_follower_count
  FROM brands b WHERE b.id = v_brand_id;

  SELECT COUNT(*) INTO v_product_count
  FROM brand_products WHERE brand_id = v_brand_id AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_post_count
  FROM brand_posts WHERE brand_id = v_brand_id AND deleted_at IS NULL;

  -- Ambassador count (accepted only; hidden players are not counted)
  SELECT COUNT(*) INTO v_ambassador_count
  FROM brand_ambassadors ba
  JOIN profiles pl ON pl.id = ba.player_id
  WHERE ba.brand_id = v_brand_id
    AND ba.status = 'accepted'
    AND NOT public.profile_is_hidden(pl.is_blocked, pl.frozen_minor_at);

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

REVOKE ALL ON FUNCTION public.get_my_brand_analytics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_brand_analytics(integer) TO authenticated, service_role;
