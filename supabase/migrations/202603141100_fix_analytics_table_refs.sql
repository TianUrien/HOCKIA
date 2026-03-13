-- Fix table references in advanced analytics RPCs
-- - admin_get_feed_analytics: posts → user_posts + brand_posts, status → deleted_at
-- - admin_get_marketplace_health: vacancies → opportunities
-- - Add GRANT EXECUTE for all 5 functions

-- ============================================================================
-- 1. FIX: FEED & CONTENT ANALYTICS
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_feed_analytics(
  p_days INT DEFAULT 30,
  p_exclude_test BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
  v_prev_since TIMESTAMPTZ := v_since - (p_days || ' days')::INTERVAL;
  v_result JSONB;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH test_ids AS (
    SELECT id FROM profiles WHERE p_exclude_test AND COALESCE(is_test_account, false) = true
  ),
  -- Current period user_posts stats
  current_user_posts AS (
    SELECT
      COUNT(*) AS total_posts,
      COUNT(DISTINCT author_id) AS unique_authors,
      COUNT(*) FILTER (WHERE post_type = 'text') AS text_posts,
      COUNT(*) FILTER (WHERE post_type = 'transfer') AS transfer_posts,
      COUNT(*) FILTER (WHERE post_type = 'signing') AS signing_posts
    FROM user_posts
    WHERE created_at >= v_since
      AND deleted_at IS NULL
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Brand posts count
  current_brand_posts AS (
    SELECT COUNT(*) AS brand_posts
    FROM brand_posts
    WHERE created_at >= v_since
      AND deleted_at IS NULL
  ),
  -- Previous period for trend
  prev_posts AS (
    SELECT COUNT(*) AS total_posts
    FROM user_posts
    WHERE created_at >= v_prev_since AND created_at < v_since
      AND deleted_at IS NULL
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Like events from events table
  like_stats AS (
    SELECT
      COUNT(*) AS total_likes,
      COUNT(DISTINCT user_id) AS unique_likers
    FROM events
    WHERE event_name = 'post_like'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
      AND (properties->>'liked')::boolean IS NOT false
  ),
  prev_likes AS (
    SELECT COUNT(*) AS total_likes
    FROM events
    WHERE event_name = 'post_like'
      AND created_at >= v_prev_since AND created_at < v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
      AND (properties->>'liked')::boolean IS NOT false
  ),
  -- Comment events
  comment_stats AS (
    SELECT
      COUNT(*) AS total_comments,
      COUNT(DISTINCT user_id) AS unique_commenters
    FROM events
    WHERE event_name = 'post_comment_create'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  prev_comments AS (
    SELECT COUNT(*) AS total_comments
    FROM events
    WHERE event_name = 'post_comment_create'
      AND created_at >= v_prev_since AND created_at < v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Daily trend
  daily_trend AS (
    SELECT
      d.day::date AS day,
      COALESCE(p.cnt, 0) AS posts,
      COALESCE(l.cnt, 0) AS likes,
      COALESCE(c.cnt, 0) AS comments
    FROM generate_series(v_since::date, CURRENT_DATE, '1 day') AS d(day)
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS cnt
      FROM user_posts
      WHERE created_at >= v_since AND deleted_at IS NULL
        AND author_id NOT IN (SELECT id FROM test_ids)
      GROUP BY 1
    ) p ON p.day = d.day
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS cnt
      FROM events
      WHERE event_name = 'post_like' AND created_at >= v_since
        AND user_id NOT IN (SELECT id FROM test_ids)
        AND (properties->>'liked')::boolean IS NOT false
      GROUP BY 1
    ) l ON l.day = d.day
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS cnt
      FROM events
      WHERE event_name = 'post_comment_create' AND created_at >= v_since
        AND user_id NOT IN (SELECT id FROM test_ids)
      GROUP BY 1
    ) c ON c.day = d.day
    ORDER BY d.day
  ),
  -- Posts by role
  posts_by_role AS (
    SELECT
      p.role,
      COUNT(*) AS count
    FROM user_posts po
    JOIN profiles p ON po.author_id = p.id
    WHERE po.created_at >= v_since
      AND po.deleted_at IS NULL
      AND po.author_id NOT IN (SELECT id FROM test_ids)
    GROUP BY p.role
    ORDER BY count DESC
  ),
  -- Top posts by engagement
  top_posts AS (
    SELECT
      po.id,
      po.content,
      po.post_type,
      po.created_at,
      pr.full_name AS author_name,
      pr.role AS author_role,
      pr.avatar_url AS author_avatar,
      COALESCE(po.like_count, 0) AS like_count,
      COALESCE(po.comment_count, 0) AS comment_count,
      COALESCE(po.like_count, 0) + COALESCE(po.comment_count, 0) AS engagement
    FROM user_posts po
    JOIN profiles pr ON po.author_id = pr.id
    WHERE po.created_at >= v_since
      AND po.deleted_at IS NULL
      AND po.author_id NOT IN (SELECT id FROM test_ids)
    ORDER BY engagement DESC, po.created_at DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'total_posts', cup.total_posts + cbp.brand_posts,
        'unique_authors', cup.unique_authors,
        'user_posts', cup.text_posts,
        'transfer_posts', cup.transfer_posts,
        'signing_posts', cup.signing_posts,
        'brand_posts', cbp.brand_posts,
        'prev_total_posts', pp.total_posts,
        'total_likes', ls.total_likes,
        'unique_likers', ls.unique_likers,
        'prev_total_likes', pl.total_likes,
        'total_comments', cs.total_comments,
        'unique_commenters', cs.unique_commenters,
        'prev_total_comments', pc.total_comments
      )
      FROM current_user_posts cup, current_brand_posts cbp, prev_posts pp, like_stats ls, prev_likes pl, comment_stats cs, prev_comments pc
    ),
    'daily_trend', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'posts', posts, 'likes', likes, 'comments', comments)) FROM daily_trend), '[]'::jsonb),
    'posts_by_role', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', role, 'count', count)) FROM posts_by_role), '[]'::jsonb),
    'top_posts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'content', LEFT(content, 120), 'post_type', post_type, 'created_at', created_at,
      'author_name', author_name, 'author_role', author_role, 'author_avatar', author_avatar,
      'like_count', like_count, 'comment_count', comment_count
    )) FROM top_posts), '[]'::jsonb),
    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 2. FIX: MARKETPLACE HEALTH (vacancies → opportunities)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_marketplace_health(
  p_days INT DEFAULT 30,
  p_exclude_test BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
  v_result JSONB;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH test_ids AS (
    SELECT id FROM profiles WHERE p_exclude_test AND COALESCE(is_test_account, false) = true
  ),
  -- Supply: players/coaches open to opportunities
  supply AS (
    SELECT
      COUNT(*) FILTER (WHERE role = 'player' AND open_to_opportunities = true) AS players_available,
      COUNT(*) FILTER (WHERE role = 'player') AS total_players,
      COUNT(*) FILTER (WHERE role = 'coach' AND open_to_opportunities = true) AS coaches_available,
      COUNT(*) FILTER (WHERE role = 'coach') AS total_coaches
    FROM profiles
    WHERE onboarding_completed = true
      AND id NOT IN (SELECT id FROM test_ids)
  ),
  -- Demand: open opportunities
  demand AS (
    SELECT
      COUNT(*) AS open_vacancies,
      COUNT(DISTINCT club_id) AS clubs_hiring,
      COUNT(*) FILTER (WHERE created_at >= v_since) AS new_vacancies_period
    FROM opportunities
    WHERE status = 'open'
      AND club_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Application velocity
  app_velocity AS (
    SELECT
      COUNT(*) AS applications_period,
      COUNT(DISTINCT applicant_id) AS unique_applicants,
      COUNT(DISTINCT opportunity_id) AS vacancies_applied_to
    FROM opportunity_applications
    WHERE applied_at >= v_since
      AND applicant_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Avg time to first application (for opportunities created in period)
  time_to_first AS (
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (first_app - o.created_at)) / 3600)::numeric, 1) AS avg_hours_to_first_app
    FROM opportunities o
    LEFT JOIN LATERAL (
      SELECT MIN(applied_at) AS first_app
      FROM opportunity_applications
      WHERE opportunity_id = o.id
    ) fa ON true
    WHERE o.created_at >= v_since
      AND o.status != 'draft'
      AND fa.first_app IS NOT NULL
      AND o.club_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Applicant status breakdown
  status_breakdown AS (
    SELECT
      oa.status,
      COUNT(*) AS count
    FROM opportunity_applications oa
    JOIN opportunities o ON oa.opportunity_id = o.id
    WHERE oa.applied_at >= v_since
      AND oa.applicant_id NOT IN (SELECT id FROM test_ids)
    GROUP BY oa.status
    ORDER BY count DESC
  ),
  -- Opportunities by position
  by_position AS (
    SELECT
      COALESCE(position::text, 'Unspecified') AS position,
      COUNT(*) AS count
    FROM opportunities
    WHERE status = 'open'
      AND club_id NOT IN (SELECT id FROM test_ids)
    GROUP BY position
    ORDER BY count DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'supply', (SELECT jsonb_build_object(
      'players_available', players_available,
      'total_players', total_players,
      'coaches_available', coaches_available,
      'total_coaches', total_coaches
    ) FROM supply),
    'demand', (SELECT jsonb_build_object(
      'open_vacancies', open_vacancies,
      'clubs_hiring', clubs_hiring,
      'new_vacancies_period', new_vacancies_period
    ) FROM demand),
    'velocity', (SELECT jsonb_build_object(
      'applications_period', applications_period,
      'unique_applicants', unique_applicants,
      'vacancies_applied_to', vacancies_applied_to,
      'avg_hours_to_first_app', COALESCE(ttf.avg_hours_to_first_app, 0)
    ) FROM app_velocity av, time_to_first ttf),
    'status_breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'count', count)) FROM status_breakdown), '[]'::jsonb),
    'by_position', COALESCE((SELECT jsonb_agg(jsonb_build_object('position', position, 'count', count)) FROM by_position), '[]'::jsonb),
    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 3. GRANT EXECUTE for all advanced analytics functions
-- ============================================================================

GRANT EXECUTE ON FUNCTION admin_get_feed_analytics TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_notification_effectiveness TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_conversion_funnels TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_community_analytics TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_marketplace_health TO authenticated;
