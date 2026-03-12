-- ============================================================================
-- Monthly Platform Report RPC
-- ============================================================================
-- Returns a comprehensive monthly snapshot for the admin portal.
-- Single RPC call returns all metrics for a given month, plus the previous
-- month for comparison. Excludes test accounts throughout.
-- ============================================================================

SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_get_monthly_report(
  p_year  INT DEFAULT EXTRACT(YEAR FROM now())::INT,
  p_month INT DEFAULT EXTRACT(MONTH FROM now())::INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start    TIMESTAMPTZ;
  v_end      TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_prev_end   TIMESTAMPTZ;
  v_current  JSONB;
  v_previous JSONB;
BEGIN
  -- Admin-only check
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Current month boundaries
  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0);
  v_end   := v_start + INTERVAL '1 month';

  -- Previous month boundaries
  v_prev_start := v_start - INTERVAL '1 month';
  v_prev_end   := v_start;

  -- ── Collect metrics for a given period ──────────────────────────────────
  -- We run the same query structure twice (current + previous) via a helper
  -- approach using two SELECT INTO blocks.

  -- ══════════════════════════════════════════════════════════════════════════
  -- CURRENT MONTH
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT jsonb_build_object(
    -- ── Growth ──
    'new_signups', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at >= v_start AND created_at < v_end
        AND COALESCE(is_test_account, false) = false
    ),
    'new_players', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at >= v_start AND created_at < v_end
        AND role = 'player'
        AND COALESCE(is_test_account, false) = false
    ),
    'new_coaches', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at >= v_start AND created_at < v_end
        AND role = 'coach'
        AND COALESCE(is_test_account, false) = false
    ),
    'new_clubs', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at >= v_start AND created_at < v_end
        AND role = 'club'
        AND COALESCE(is_test_account, false) = false
    ),
    'new_brands', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at >= v_start AND created_at < v_end
        AND role = 'brand'
        AND COALESCE(is_test_account, false) = false
    ),
    'onboarding_completed', (
      SELECT COUNT(*) FROM profiles
      WHERE onboarding_completed_at >= v_start AND onboarding_completed_at < v_end
        AND COALESCE(is_test_account, false) = false
    ),
    'total_users', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at < v_end
        AND COALESCE(is_test_account, false) = false
    ),

    -- ── Engagement ──
    'mau', (
      SELECT COUNT(DISTINCT user_id) FROM user_engagement_daily
      WHERE date >= v_start::date AND date < v_end::date
    ),
    'avg_dau', (
      SELECT COALESCE(ROUND(AVG(daily_users)), 0)
      FROM (
        SELECT date, COUNT(DISTINCT user_id) AS daily_users
        FROM user_engagement_daily
        WHERE date >= v_start::date AND date < v_end::date
        GROUP BY date
      ) d
    ),
    'total_sessions', (
      SELECT COALESCE(SUM(session_count), 0) FROM user_engagement_daily
      WHERE date >= v_start::date AND date < v_end::date
    ),
    'total_minutes', (
      SELECT COALESCE(ROUND(SUM(total_seconds) / 60.0), 0) FROM user_engagement_daily
      WHERE date >= v_start::date AND date < v_end::date
    ),
    'avg_session_minutes', (
      SELECT COALESCE(
        ROUND(SUM(total_seconds) / NULLIF(SUM(session_count), 0) / 60.0, 1),
        0
      ) FROM user_engagement_daily
      WHERE date >= v_start::date AND date < v_end::date
    ),
    'returning_users', (
      SELECT COUNT(DISTINCT ued.user_id)
      FROM user_engagement_daily ued
      WHERE ued.date >= v_start::date AND ued.date < v_end::date
        AND EXISTS (
          SELECT 1 FROM user_engagement_daily prev
          WHERE prev.user_id = ued.user_id
            AND prev.date >= v_prev_start::date AND prev.date < v_prev_end::date
        )
    ),

    -- ── Opportunities ──
    'opportunities_created', (
      SELECT COUNT(*) FROM opportunities
      WHERE created_at >= v_start AND created_at < v_end
    ),
    'opportunities_closed', (
      SELECT COUNT(*) FROM opportunities
      WHERE closed_at >= v_start AND closed_at < v_end
    ),
    'applications_submitted', (
      SELECT COUNT(*) FROM opportunity_applications
      WHERE applied_at >= v_start AND applied_at < v_end
    ),
    'unique_applicants', (
      SELECT COUNT(DISTINCT applicant_id) FROM opportunity_applications
      WHERE applied_at >= v_start AND applied_at < v_end
    ),

    -- ── Social & Trust ──
    'messages_sent', (
      SELECT COUNT(*) FROM messages
      WHERE sent_at >= v_start AND sent_at < v_end
    ),
    'active_conversations', (
      SELECT COUNT(DISTINCT conversation_id) FROM messages
      WHERE sent_at >= v_start AND sent_at < v_end
    ),
    'friend_requests_sent', (
      SELECT COUNT(*) FROM profile_friendships
      WHERE created_at >= v_start AND created_at < v_end
    ),
    'friendships_accepted', (
      SELECT COUNT(*) FROM profile_friendships
      WHERE accepted_at >= v_start AND accepted_at < v_end
    ),
    'references_requested', (
      SELECT COUNT(*) FROM profile_references
      WHERE created_at >= v_start AND created_at < v_end
    ),
    'references_accepted', (
      SELECT COUNT(*) FROM profile_references
      WHERE accepted_at >= v_start AND accepted_at < v_end
    ),

    -- ── Content ──
    'posts_created', (
      SELECT COUNT(*) FROM user_posts
      WHERE created_at >= v_start AND created_at < v_end
        AND deleted_at IS NULL
    ),
    'comments_created', (
      SELECT COUNT(*) FROM post_comments
      WHERE created_at >= v_start AND created_at < v_end
    ),
    'likes_given', (
      SELECT COUNT(*) FROM post_likes
      WHERE created_at >= v_start AND created_at < v_end
    ),
    'media_uploads', (
      SELECT COUNT(*) FROM gallery_photos
      WHERE created_at >= v_start AND created_at < v_end
    ),
    'community_questions', (
      SELECT COUNT(*) FROM community_questions
      WHERE created_at >= v_start AND created_at < v_end
    ),
    'community_answers', (
      SELECT COUNT(*) FROM community_answers
      WHERE created_at >= v_start AND created_at < v_end
    ),

    -- ── Feature Adoption ──
    'discovery_queries', (
      SELECT COUNT(*) FROM discovery_events
      WHERE created_at >= v_start AND created_at < v_end
    ),
    'discovery_users', (
      SELECT COUNT(DISTINCT user_id) FROM discovery_events
      WHERE created_at >= v_start AND created_at < v_end
    ),
    'brand_posts_published', (
      SELECT COUNT(*) FROM brand_posts
      WHERE created_at >= v_start AND created_at < v_end
        AND deleted_at IS NULL
    ),
    'brand_followers_gained', (
      SELECT COUNT(*) FROM brand_followers
      WHERE created_at >= v_start AND created_at < v_end
    ),

    -- ── Email ──
    'emails_sent', (
      SELECT COUNT(*) FROM email_sends
      WHERE sent_at >= v_start AND sent_at < v_end
    ),
    'email_open_rate', (
      SELECT COALESCE(
        ROUND(
          COUNT(*) FILTER (WHERE event_type = 'opened')::numeric /
          NULLIF(COUNT(*) FILTER (WHERE event_type = 'delivered'), 0) * 100,
          1
        ), 0
      ) FROM email_events
      WHERE created_at >= v_start AND created_at < v_end
    ),
    'email_click_rate', (
      SELECT COALESCE(
        ROUND(
          COUNT(*) FILTER (WHERE event_type = 'clicked')::numeric /
          NULLIF(COUNT(*) FILTER (WHERE event_type = 'delivered'), 0) * 100,
          1
        ), 0
      ) FROM email_events
      WHERE created_at >= v_start AND created_at < v_end
    )
  ) INTO v_current;

  -- ══════════════════════════════════════════════════════════════════════════
  -- PREVIOUS MONTH (same structure, different date range)
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT jsonb_build_object(
    'new_signups', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
        AND COALESCE(is_test_account, false) = false
    ),
    'new_players', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
        AND role = 'player'
        AND COALESCE(is_test_account, false) = false
    ),
    'new_coaches', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
        AND role = 'coach'
        AND COALESCE(is_test_account, false) = false
    ),
    'new_clubs', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
        AND role = 'club'
        AND COALESCE(is_test_account, false) = false
    ),
    'new_brands', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
        AND role = 'brand'
        AND COALESCE(is_test_account, false) = false
    ),
    'onboarding_completed', (
      SELECT COUNT(*) FROM profiles
      WHERE onboarding_completed_at >= v_prev_start AND onboarding_completed_at < v_prev_end
        AND COALESCE(is_test_account, false) = false
    ),
    'total_users', (
      SELECT COUNT(*) FROM profiles
      WHERE created_at < v_prev_end
        AND COALESCE(is_test_account, false) = false
    ),
    'mau', (
      SELECT COUNT(DISTINCT user_id) FROM user_engagement_daily
      WHERE date >= v_prev_start::date AND date < v_prev_end::date
    ),
    'avg_dau', (
      SELECT COALESCE(ROUND(AVG(daily_users)), 0)
      FROM (
        SELECT date, COUNT(DISTINCT user_id) AS daily_users
        FROM user_engagement_daily
        WHERE date >= v_prev_start::date AND date < v_prev_end::date
        GROUP BY date
      ) d
    ),
    'total_sessions', (
      SELECT COALESCE(SUM(session_count), 0) FROM user_engagement_daily
      WHERE date >= v_prev_start::date AND date < v_prev_end::date
    ),
    'total_minutes', (
      SELECT COALESCE(ROUND(SUM(total_seconds) / 60.0), 0) FROM user_engagement_daily
      WHERE date >= v_prev_start::date AND date < v_prev_end::date
    ),
    'avg_session_minutes', (
      SELECT COALESCE(
        ROUND(SUM(total_seconds) / NULLIF(SUM(session_count), 0) / 60.0, 1),
        0
      ) FROM user_engagement_daily
      WHERE date >= v_prev_start::date AND date < v_prev_end::date
    ),
    'returning_users', (
      SELECT COUNT(DISTINCT ued.user_id)
      FROM user_engagement_daily ued
      WHERE ued.date >= v_prev_start::date AND ued.date < v_prev_end::date
        AND EXISTS (
          SELECT 1 FROM user_engagement_daily prev
          WHERE prev.user_id = ued.user_id
            AND prev.date >= (v_prev_start - INTERVAL '1 month')::date
            AND prev.date < v_prev_start::date
        )
    ),
    'opportunities_created', (
      SELECT COUNT(*) FROM opportunities
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'opportunities_closed', (
      SELECT COUNT(*) FROM opportunities
      WHERE closed_at >= v_prev_start AND closed_at < v_prev_end
    ),
    'applications_submitted', (
      SELECT COUNT(*) FROM opportunity_applications
      WHERE applied_at >= v_prev_start AND applied_at < v_prev_end
    ),
    'unique_applicants', (
      SELECT COUNT(DISTINCT applicant_id) FROM opportunity_applications
      WHERE applied_at >= v_prev_start AND applied_at < v_prev_end
    ),
    'messages_sent', (
      SELECT COUNT(*) FROM messages
      WHERE sent_at >= v_prev_start AND sent_at < v_prev_end
    ),
    'active_conversations', (
      SELECT COUNT(DISTINCT conversation_id) FROM messages
      WHERE sent_at >= v_prev_start AND sent_at < v_prev_end
    ),
    'friend_requests_sent', (
      SELECT COUNT(*) FROM profile_friendships
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'friendships_accepted', (
      SELECT COUNT(*) FROM profile_friendships
      WHERE accepted_at >= v_prev_start AND accepted_at < v_prev_end
    ),
    'references_requested', (
      SELECT COUNT(*) FROM profile_references
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'references_accepted', (
      SELECT COUNT(*) FROM profile_references
      WHERE accepted_at >= v_prev_start AND accepted_at < v_prev_end
    ),
    'posts_created', (
      SELECT COUNT(*) FROM user_posts
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
        AND deleted_at IS NULL
    ),
    'comments_created', (
      SELECT COUNT(*) FROM post_comments
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'likes_given', (
      SELECT COUNT(*) FROM post_likes
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'media_uploads', (
      SELECT COUNT(*) FROM gallery_photos
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'community_questions', (
      SELECT COUNT(*) FROM community_questions
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'community_answers', (
      SELECT COUNT(*) FROM community_answers
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'discovery_queries', (
      SELECT COUNT(*) FROM discovery_events
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'discovery_users', (
      SELECT COUNT(DISTINCT user_id) FROM discovery_events
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'brand_posts_published', (
      SELECT COUNT(*) FROM brand_posts
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
        AND deleted_at IS NULL
    ),
    'brand_followers_gained', (
      SELECT COUNT(*) FROM brand_followers
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'emails_sent', (
      SELECT COUNT(*) FROM email_sends
      WHERE sent_at >= v_prev_start AND sent_at < v_prev_end
    ),
    'email_open_rate', (
      SELECT COALESCE(
        ROUND(
          COUNT(*) FILTER (WHERE event_type = 'opened')::numeric /
          NULLIF(COUNT(*) FILTER (WHERE event_type = 'delivered'), 0) * 100,
          1
        ), 0
      ) FROM email_events
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    ),
    'email_click_rate', (
      SELECT COALESCE(
        ROUND(
          COUNT(*) FILTER (WHERE event_type = 'clicked')::numeric /
          NULLIF(COUNT(*) FILTER (WHERE event_type = 'delivered'), 0) * 100,
          1
        ), 0
      ) FROM email_events
      WHERE created_at >= v_prev_start AND created_at < v_prev_end
    )
  ) INTO v_previous;

  RETURN jsonb_build_object(
    'current', v_current,
    'previous', v_previous,
    'month', p_month,
    'year', p_year,
    'generated_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_monthly_report IS
  'Returns comprehensive monthly platform metrics with previous month for comparison. Admin-only.';

GRANT EXECUTE ON FUNCTION public.admin_get_monthly_report TO authenticated;
