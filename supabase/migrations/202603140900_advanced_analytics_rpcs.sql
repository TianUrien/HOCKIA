-- Advanced Analytics RPCs
-- Feed & content analytics, notification effectiveness, conversion funnels,
-- community analytics, marketplace health

-- ============================================================================
-- 1. FEED & CONTENT ANALYTICS
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
  -- Current period post stats
  current_posts AS (
    SELECT
      COUNT(*) AS total_posts,
      COUNT(DISTINCT author_id) AS unique_authors,
      COUNT(*) FILTER (WHERE post_type = 'user') AS user_posts,
      COUNT(*) FILTER (WHERE post_type = 'transfer') AS transfer_posts,
      COUNT(*) FILTER (WHERE post_type = 'signing') AS signing_posts,
      COUNT(*) FILTER (WHERE post_type = 'brand') AS brand_posts
    FROM posts
    WHERE created_at >= v_since
      AND status = 'visible'
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Previous period for trend
  prev_posts AS (
    SELECT COUNT(*) AS total_posts
    FROM posts
    WHERE created_at >= v_prev_since AND created_at < v_since
      AND status = 'visible'
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
      FROM posts
      WHERE created_at >= v_since AND status = 'visible'
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
    FROM posts po
    JOIN profiles p ON po.author_id = p.id
    WHERE po.created_at >= v_since
      AND po.status = 'visible'
      AND po.author_id NOT IN (SELECT id FROM test_ids)
    GROUP BY p.role
    ORDER BY count DESC
  ),
  -- Top posts by engagement (likes + comments from post_likes and post_comments tables)
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
    FROM posts po
    JOIN profiles pr ON po.author_id = pr.id
    WHERE po.created_at >= v_since
      AND po.status = 'visible'
      AND po.author_id NOT IN (SELECT id FROM test_ids)
    ORDER BY engagement DESC, po.created_at DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'total_posts', cp.total_posts,
        'unique_authors', cp.unique_authors,
        'user_posts', cp.user_posts,
        'transfer_posts', cp.transfer_posts,
        'signing_posts', cp.signing_posts,
        'brand_posts', cp.brand_posts,
        'prev_total_posts', pp.total_posts,
        'total_likes', ls.total_likes,
        'unique_likers', ls.unique_likers,
        'prev_total_likes', pl.total_likes,
        'total_comments', cs.total_comments,
        'unique_commenters', cs.unique_commenters,
        'prev_total_comments', pc.total_comments
      )
      FROM current_posts cp, prev_posts pp, like_stats ls, prev_likes pl, comment_stats cs, prev_comments pc
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
-- 2. NOTIFICATION EFFECTIVENESS
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_notification_effectiveness(
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
  -- Notifications created per kind
  notif_created AS (
    SELECT
      kind,
      COUNT(*) AS created,
      COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS read,
      COUNT(*) FILTER (WHERE cleared_at IS NOT NULL) AS cleared
    FROM profile_notifications
    WHERE created_at >= v_since
      AND recipient_id NOT IN (SELECT id FROM test_ids)
    GROUP BY kind
  ),
  -- Click-through events from events table
  notif_clicks AS (
    SELECT
      properties->>'kind' AS kind,
      COUNT(*) AS clicks,
      COUNT(DISTINCT user_id) AS unique_clickers
    FROM events
    WHERE event_name = 'notification_click'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
    GROUP BY properties->>'kind'
  ),
  -- Combined per kind
  per_kind AS (
    SELECT
      nc.kind,
      nc.created,
      nc.read,
      nc.cleared,
      COALESCE(nk.clicks, 0) AS clicks,
      COALESCE(nk.unique_clickers, 0) AS unique_clickers,
      CASE WHEN nc.created > 0 THEN ROUND((nc.read::numeric / nc.created) * 100, 1) ELSE 0 END AS read_rate,
      CASE WHEN nc.created > 0 THEN ROUND((COALESCE(nk.clicks, 0)::numeric / nc.created) * 100, 1) ELSE 0 END AS click_rate
    FROM notif_created nc
    LEFT JOIN notif_clicks nk ON nk.kind = nc.kind::text
    ORDER BY nc.created DESC
  ),
  -- Overall totals
  totals AS (
    SELECT
      SUM(created) AS total_created,
      SUM(read) AS total_read,
      SUM(clicks) AS total_clicks
    FROM per_kind
  ),
  -- Daily trend
  daily_trend AS (
    SELECT
      d.day::date AS day,
      COALESCE(n.created, 0) AS created,
      COALESCE(n.read, 0) AS read,
      COALESCE(c.clicks, 0) AS clicks
    FROM generate_series(v_since::date, CURRENT_DATE, '1 day') AS d(day)
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS created, COUNT(*) FILTER (WHERE read_at IS NOT NULL) AS read
      FROM profile_notifications
      WHERE created_at >= v_since AND recipient_id NOT IN (SELECT id FROM test_ids)
      GROUP BY 1
    ) n ON n.day = d.day
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS clicks
      FROM events
      WHERE event_name = 'notification_click' AND created_at >= v_since
        AND user_id NOT IN (SELECT id FROM test_ids)
      GROUP BY 1
    ) c ON c.day = d.day
    ORDER BY d.day
  )
  SELECT jsonb_build_object(
    'totals', (SELECT jsonb_build_object(
      'total_created', COALESCE(total_created, 0),
      'total_read', COALESCE(total_read, 0),
      'total_clicks', COALESCE(total_clicks, 0),
      'overall_read_rate', CASE WHEN COALESCE(total_created, 0) > 0 THEN ROUND((COALESCE(total_read, 0)::numeric / total_created) * 100, 1) ELSE 0 END,
      'overall_click_rate', CASE WHEN COALESCE(total_created, 0) > 0 THEN ROUND((COALESCE(total_clicks, 0)::numeric / total_created) * 100, 1) ELSE 0 END
    ) FROM totals),
    'per_kind', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'kind', kind, 'created', created, 'read', read, 'cleared', cleared,
      'clicks', clicks, 'unique_clickers', unique_clickers,
      'read_rate', read_rate, 'click_rate', click_rate
    )) FROM per_kind), '[]'::jsonb),
    'daily_trend', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'created', created, 'read', read, 'clicks', clicks)) FROM daily_trend), '[]'::jsonb),
    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 3. CONVERSION FUNNELS
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_conversion_funnels(
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
  -- Profile View → Friend Request funnel
  profile_viewers AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'profile_view'
      AND created_at >= v_since
      AND user_id IS NOT NULL
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  friend_requesters AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'friend_request_send'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  friend_accepted AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'friend_request_update'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
      AND properties->>'status' = 'accepted'
  ),
  -- Vacancy View → Application funnel
  vacancy_viewers AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'vacancy_view'
      AND created_at >= v_since
      AND user_id IS NOT NULL
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  applicants AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'application_submit'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  shortlisted AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'applicant_status_change'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
      AND properties->>'new_status' = 'shortlisted'
  ),
  -- Notification → Click funnel
  notif_recipients AS (
    SELECT DISTINCT recipient_id AS user_id
    FROM profile_notifications
    WHERE created_at >= v_since
      AND recipient_id NOT IN (SELECT id FROM test_ids)
  ),
  notif_readers AS (
    SELECT DISTINCT recipient_id AS user_id
    FROM profile_notifications
    WHERE created_at >= v_since
      AND read_at IS NOT NULL
      AND recipient_id NOT IN (SELECT id FROM test_ids)
  ),
  notif_clickers AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'notification_click'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Reference funnel
  ref_requesters AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'reference_request'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
  ),
  ref_accepted AS (
    SELECT DISTINCT user_id
    FROM events
    WHERE event_name = 'reference_respond'
      AND created_at >= v_since
      AND user_id NOT IN (SELECT id FROM test_ids)
      AND (properties->>'accepted')::boolean = true
  )
  SELECT jsonb_build_object(
    'networking_funnel', jsonb_build_object(
      'profile_viewers', (SELECT COUNT(*) FROM profile_viewers),
      'friend_requesters', (SELECT COUNT(*) FROM friend_requesters),
      'friend_accepted', (SELECT COUNT(*) FROM friend_accepted)
    ),
    'opportunity_funnel', jsonb_build_object(
      'vacancy_viewers', (SELECT COUNT(*) FROM vacancy_viewers),
      'applicants', (SELECT COUNT(*) FROM applicants),
      'shortlisted', (SELECT COUNT(*) FROM shortlisted)
    ),
    'notification_funnel', jsonb_build_object(
      'recipients', (SELECT COUNT(*) FROM notif_recipients),
      'readers', (SELECT COUNT(*) FROM notif_readers),
      'clickers', (SELECT COUNT(*) FROM notif_clickers)
    ),
    'reference_funnel', jsonb_build_object(
      'requesters', (SELECT COUNT(*) FROM ref_requesters),
      'accepted', (SELECT COUNT(*) FROM ref_accepted)
    ),
    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 4. COMMUNITY ANALYTICS (Q&A)
-- ============================================================================

CREATE OR REPLACE FUNCTION admin_get_community_analytics(
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
  -- Question stats
  question_stats AS (
    SELECT
      COUNT(*) AS total_questions,
      COUNT(DISTINCT author_id) AS unique_askers
    FROM community_questions
    WHERE created_at >= v_since
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  prev_questions AS (
    SELECT COUNT(*) AS total_questions
    FROM community_questions
    WHERE created_at >= v_prev_since AND created_at < v_since
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Answer stats
  answer_stats AS (
    SELECT
      COUNT(*) AS total_answers,
      COUNT(DISTINCT author_id) AS unique_answerers
    FROM community_answers
    WHERE created_at >= v_since
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  prev_answers AS (
    SELECT COUNT(*) AS total_answers
    FROM community_answers
    WHERE created_at >= v_prev_since AND created_at < v_since
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Response rate (questions that have at least 1 answer)
  response_rate AS (
    SELECT
      COUNT(*) AS total_q,
      COUNT(*) FILTER (WHERE answer_count > 0) AS answered_q
    FROM community_questions
    WHERE created_at >= v_since
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Questions by role
  questions_by_role AS (
    SELECT
      p.role,
      COUNT(*) AS count
    FROM community_questions q
    JOIN profiles p ON q.author_id = p.id
    WHERE q.created_at >= v_since
      AND q.author_id NOT IN (SELECT id FROM test_ids)
    GROUP BY p.role
    ORDER BY count DESC
  ),
  -- Top contributors (answers)
  top_contributors AS (
    SELECT
      p.id,
      p.full_name,
      p.role,
      p.avatar_url,
      COUNT(*) AS answer_count
    FROM community_answers a
    JOIN profiles p ON a.author_id = p.id
    WHERE a.created_at >= v_since
      AND a.author_id NOT IN (SELECT id FROM test_ids)
    GROUP BY p.id, p.full_name, p.role, p.avatar_url
    ORDER BY answer_count DESC
    LIMIT 10
  ),
  -- Daily trend
  daily_trend AS (
    SELECT
      d.day::date AS day,
      COALESCE(q.cnt, 0) AS questions,
      COALESCE(a.cnt, 0) AS answers
    FROM generate_series(v_since::date, CURRENT_DATE, '1 day') AS d(day)
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS cnt
      FROM community_questions
      WHERE created_at >= v_since AND author_id NOT IN (SELECT id FROM test_ids)
      GROUP BY 1
    ) q ON q.day = d.day
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS cnt
      FROM community_answers
      WHERE created_at >= v_since AND author_id NOT IN (SELECT id FROM test_ids)
      GROUP BY 1
    ) a ON a.day = d.day
    ORDER BY d.day
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'total_questions', qs.total_questions,
        'unique_askers', qs.unique_askers,
        'prev_total_questions', pq.total_questions,
        'total_answers', ans.total_answers,
        'unique_answerers', ans.unique_answerers,
        'prev_total_answers', pa.total_answers,
        'response_rate', CASE WHEN rr.total_q > 0 THEN ROUND((rr.answered_q::numeric / rr.total_q) * 100, 1) ELSE 0 END
      )
      FROM question_stats qs, prev_questions pq, answer_stats ans, prev_answers pa, response_rate rr
    ),
    'questions_by_role', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', role, 'count', count)) FROM questions_by_role), '[]'::jsonb),
    'top_contributors', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'full_name', full_name, 'role', role, 'avatar_url', avatar_url, 'answer_count', answer_count
    )) FROM top_contributors), '[]'::jsonb),
    'daily_trend', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'questions', questions, 'answers', answers)) FROM daily_trend), '[]'::jsonb),
    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 5. MARKETPLACE HEALTH
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
  -- Demand: open vacancies
  demand AS (
    SELECT
      COUNT(*) AS open_vacancies,
      COUNT(DISTINCT club_id) AS clubs_hiring,
      COUNT(*) FILTER (WHERE created_at >= v_since) AS new_vacancies_period
    FROM vacancies
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
  -- Avg time to first application (for vacancies created in period)
  time_to_first AS (
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (first_app - v.created_at)) / 3600)::numeric, 1) AS avg_hours_to_first_app
    FROM vacancies v
    LEFT JOIN LATERAL (
      SELECT MIN(applied_at) AS first_app
      FROM opportunity_applications
      WHERE opportunity_id = v.id
    ) fa ON true
    WHERE v.created_at >= v_since
      AND v.status != 'draft'
      AND fa.first_app IS NOT NULL
      AND v.club_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Applicant status breakdown
  status_breakdown AS (
    SELECT
      oa.status,
      COUNT(*) AS count
    FROM opportunity_applications oa
    JOIN vacancies v ON oa.opportunity_id = v.id
    WHERE oa.applied_at >= v_since
      AND oa.applicant_id NOT IN (SELECT id FROM test_ids)
    GROUP BY oa.status
    ORDER BY count DESC
  ),
  -- Vacancies by position
  by_position AS (
    SELECT
      COALESCE(position, 'Unspecified') AS position,
      COUNT(*) AS count
    FROM vacancies
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
