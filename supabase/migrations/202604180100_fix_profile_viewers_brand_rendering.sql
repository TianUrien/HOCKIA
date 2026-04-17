-- Fix "Who Viewed Your Profile" brand row rendering
--
-- Two issues:
--   1. Brand viewers with incomplete onboarding (profiles row exists, but
--      brands row never created) surfaced in the list with NULL full_name
--      and avatar_url — rendered as a purple "?" with an empty name.
--   2. The RPC never returned brand_slug, so the frontend had no way to link
--      a brand viewer to its profile (brand pages are /brands/:slug).
--
-- Fix: filter on profiles.onboarding_completed (reliable proxy for "has a
-- brands row" — BrandOnboardingPage sets onboarding_completed = true only
-- after create_brand succeeds), LEFT JOIN brands to return brand_slug, and
-- preserve the bidirectional block filter added in 202603250500.

SET search_path = public;

DROP FUNCTION IF EXISTS public.get_my_profile_viewers(INT, INT);

CREATE OR REPLACE FUNCTION public.get_my_profile_viewers(
  p_days INT DEFAULT 30,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  viewer_id UUID,
  full_name TEXT,
  role TEXT,
  username TEXT,
  avatar_url TEXT,
  base_location TEXT,
  brand_slug TEXT,
  viewed_at TIMESTAMPTZ,
  view_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_since TIMESTAMPTZ;
  v_clamped_limit INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  v_since := now() - (p_days || ' days')::INTERVAL;
  v_clamped_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);

  RETURN QUERY
  WITH viewer_events AS (
    SELECT
      e.user_id AS vid,
      MAX(e.created_at) AS last_viewed_at,
      COUNT(*) AS cnt
    FROM events e
    WHERE e.event_name = 'profile_view'
      AND e.entity_type = 'profile'
      AND e.entity_id = v_user_id
      AND e.created_at >= v_since
      AND e.user_id IS NOT NULL
      AND e.user_id != v_user_id
    GROUP BY e.user_id
  )
  SELECT
    ve.vid AS viewer_id,
    p.full_name,
    p.role,
    p.username,
    p.avatar_url,
    p.base_location,
    b.slug AS brand_slug,
    ve.last_viewed_at AS viewed_at,
    ve.cnt AS view_count
  FROM viewer_events ve
  INNER JOIN profiles p ON p.id = ve.vid
  LEFT JOIN brands b ON b.profile_id = ve.vid AND b.deleted_at IS NULL
  WHERE p.browse_anonymously = false
    AND COALESCE(p.is_test_account, false) = false
    AND p.onboarding_completed = true
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = ve.vid)
         OR (ub.blocker_id = ve.vid AND ub.blocked_id = v_user_id)
    )
  ORDER BY ve.last_viewed_at DESC
  LIMIT v_clamped_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_profile_viewers(INT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
