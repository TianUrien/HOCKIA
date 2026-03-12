-- Who Viewed Your Profile
-- Adds user-facing profile view analytics: RPCs to query viewers/stats,
-- privacy toggle, and daily batched notification cron job.

--------------------------------------------------------------------------------
-- 1. Privacy toggle on profiles
--------------------------------------------------------------------------------
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS browse_anonymously BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.browse_anonymously IS
  'When true, this user does not appear in "Who Viewed Your Profile" lists for other users.';

--------------------------------------------------------------------------------
-- 2. Add profile_viewed notification kind
--------------------------------------------------------------------------------
ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'profile_viewed';

--------------------------------------------------------------------------------
-- 3. Partial index for efficient profile-view queries
--------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS events_profile_view_entity_idx
  ON public.events (entity_id, created_at DESC)
  WHERE event_name = 'profile_view' AND entity_type = 'profile' AND user_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 4. get_my_profile_viewers(p_days, p_limit) — list of recent viewers
--------------------------------------------------------------------------------
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
    ve.last_viewed_at AS viewed_at,
    ve.cnt AS view_count
  FROM viewer_events ve
  INNER JOIN profiles p ON p.id = ve.vid
  WHERE p.browse_anonymously = false
    AND COALESCE(p.is_test_account, false) = false
  ORDER BY ve.last_viewed_at DESC
  LIMIT v_clamped_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_profile_viewers(INT, INT) TO authenticated;

--------------------------------------------------------------------------------
-- 5. get_my_profile_view_stats(p_days) — aggregate stats with trend
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_profile_view_stats(
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
  v_since TIMESTAMPTZ;
  v_previous_start TIMESTAMPTZ;
  v_total_views BIGINT := 0;
  v_unique_viewers BIGINT := 0;
  v_previous_total BIGINT := 0;
  v_previous_unique BIGINT := 0;
  v_anonymous_viewers BIGINT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_since := now() - (p_days || ' days')::INTERVAL;
  v_previous_start := v_since - (p_days || ' days')::INTERVAL;

  -- Current period stats (all authenticated views, excluding self and test accounts)
  SELECT
    COALESCE(COUNT(*), 0),
    COALESCE(COUNT(DISTINCT e.user_id), 0)
  INTO v_total_views, v_unique_viewers
  FROM events e
  LEFT JOIN profiles p ON p.id = e.user_id
  WHERE e.event_name = 'profile_view'
    AND e.entity_type = 'profile'
    AND e.entity_id = v_user_id
    AND e.created_at >= v_since
    AND e.user_id IS NOT NULL
    AND e.user_id != v_user_id
    AND COALESCE(p.is_test_account, false) = false;

  -- Previous period for trend comparison
  SELECT
    COALESCE(COUNT(*), 0),
    COALESCE(COUNT(DISTINCT e.user_id), 0)
  INTO v_previous_total, v_previous_unique
  FROM events e
  LEFT JOIN profiles p ON p.id = e.user_id
  WHERE e.event_name = 'profile_view'
    AND e.entity_type = 'profile'
    AND e.entity_id = v_user_id
    AND e.created_at >= v_previous_start
    AND e.created_at < v_since
    AND e.user_id IS NOT NULL
    AND e.user_id != v_user_id
    AND COALESCE(p.is_test_account, false) = false;

  -- Count unique viewers who have browse_anonymously enabled
  SELECT COALESCE(COUNT(DISTINCT e.user_id), 0)
  INTO v_anonymous_viewers
  FROM events e
  INNER JOIN profiles p ON p.id = e.user_id
  WHERE e.event_name = 'profile_view'
    AND e.entity_type = 'profile'
    AND e.entity_id = v_user_id
    AND e.created_at >= v_since
    AND e.user_id != v_user_id
    AND p.browse_anonymously = true
    AND COALESCE(p.is_test_account, false) = false;

  RETURN jsonb_build_object(
    'success', true,
    'total_views', v_total_views,
    'unique_viewers', v_unique_viewers,
    'previous_total_views', v_previous_total,
    'previous_unique_viewers', v_previous_unique,
    'anonymous_viewers', v_anonymous_viewers
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_profile_view_stats(INT) TO authenticated;

--------------------------------------------------------------------------------
-- 6. Daily batched profile-view notifications
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_profile_view_notifications(
  p_batch INT DEFAULT 5000,
  p_min_views INT DEFAULT 1
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ;
  v_inserted INT := 0;
BEGIN
  v_since := now() - INTERVAL '24 hours';

  WITH profile_view_counts AS (
    SELECT
      e.entity_id AS viewed_profile_id,
      COUNT(DISTINCT e.user_id) AS unique_viewers,
      COUNT(*) AS total_views,
      (ARRAY_AGG(e.user_id ORDER BY e.created_at DESC))[1] AS latest_viewer_id
    FROM events e
    INNER JOIN profiles p ON p.id = e.user_id
    WHERE e.event_name = 'profile_view'
      AND e.entity_type = 'profile'
      AND e.user_id IS NOT NULL
      AND e.created_at >= v_since
      AND COALESCE(p.is_test_account, false) = false
    GROUP BY e.entity_id
    HAVING COUNT(DISTINCT e.user_id) >= p_min_views
    LIMIT p_batch
  ),
  eligible AS (
    SELECT pvc.*
    FROM profile_view_counts pvc
    INNER JOIN profiles viewed ON viewed.id = pvc.viewed_profile_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM profile_notifications pn
      WHERE pn.recipient_profile_id = pvc.viewed_profile_id
        AND pn.kind = 'profile_viewed'
        AND pn.created_at >= v_since
    )
    AND viewed.onboarding_completed = true
    AND COALESCE(viewed.is_test_account, false) = false
    AND pvc.viewed_profile_id != pvc.latest_viewer_id
  ),
  inserted AS (
    INSERT INTO profile_notifications (
      recipient_profile_id,
      actor_profile_id,
      kind,
      metadata,
      target_url,
      created_at,
      updated_at
    )
    SELECT
      el.viewed_profile_id,
      el.latest_viewer_id,
      'profile_viewed'::profile_notification_kind,
      jsonb_build_object(
        'unique_viewers', el.unique_viewers,
        'total_views', el.total_views,
        'period', '24h'
      ),
      '/dashboard/profile?tab=profile&section=viewers',
      now(),
      now()
    FROM eligible el
    RETURNING id
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$$;

-- Schedule cron job
DO $$
BEGIN
  BEGIN
    DELETE FROM cron.job WHERE jobname = 'profile_view_notifications_daily';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron cleanup: insufficient privileges';
  END;

  BEGIN
    PERFORM cron.schedule(
      'profile_view_notifications_daily',
      '30 3 * * *',
      'SELECT public.send_profile_view_notifications();'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping cron scheduling: insufficient privileges';
  END;
END;
$$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
