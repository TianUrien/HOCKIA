-- Founder-readable analytics: admin_get_engagement_overview
--
-- Companion to admin_get_command_center (untouched — other components read
-- it). One call returns everything the redesigned Overview sections need:
-- growth, activation, participation, content creation, and the north-star
-- connection metrics. All counts exclude test accounts.
--
-- Definitions (mirrored in the client tooltips — keep in sync):
--  - New users: profiles created in the window.
--  - Activated: cohort members who completed onboarding AND uploaded an
--    avatar AND (players only) set a position — the minimum setup that
--    makes a profile discoverable and matchable.
--  - Profile complete: avatar + non-empty bio (same definition the command
--    center has always used, now with absolute numbers).
--  - Contributor (7d): any user who created content in the last 7 days —
--    post, gallery photo, video, comment, message, or opportunity.
--  - Browsers vs contributors: WAU split by the above.
--  - Players contacted by clubs: conversations STARTED in the window where
--    a club/coach participant sent the first message to a player.
--  - Shortlists: applications whose status is 'shortlisted' and whose last
--    update falls in the window (status-change date proxy: updated_at).
--  - Opportunities filled: closed in the window with closed_reason='filled'
--    or filled_via_hockia = true.

CREATE OR REPLACE FUNCTION public.admin_get_engagement_overview(p_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_period_start TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_new_users BIGINT;
  v_new_users_prev BIGINT;
  v_cohort BIGINT;
  v_activated BIGINT;
  v_profile_complete BIGINT;
  v_total_non_test BIGINT;
  v_wau BIGINT;
  v_contributors_7d BIGINT;
  v_photos_7d BIGINT;
  v_videos_7d BIGINT;
  v_posts_7d BIGINT;
  v_opps_7d BIGINT;
  v_comments_7d BIGINT;
  v_messages_7d BIGINT;
  v_players_contacted BIGINT;
  v_club_convos BIGINT;
  v_shortlists BIGINT;
  v_invites_sent BIGINT;
  v_invite_joins BIGINT;
  v_filled_period BIGINT;
  v_filled_all_time BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  v_period_start := now() - (p_days || ' days')::INTERVAL;
  v_prev_start := now() - (p_days * 2 || ' days')::INTERVAL;

  -- ── Growth ────────────────────────────────────────────────────────────
  SELECT COUNT(*) INTO v_new_users
  FROM profiles WHERE NOT is_test_account AND created_at > v_period_start;

  SELECT COUNT(*) INTO v_new_users_prev
  FROM profiles WHERE NOT is_test_account
    AND created_at > v_prev_start AND created_at <= v_period_start;

  -- ── Activation (same-window cohort) ───────────────────────────────────
  SELECT COUNT(*),
         COUNT(*) FILTER (
           WHERE onboarding_completed
             AND avatar_url IS NOT NULL
             AND (role <> 'player' OR position IS NOT NULL)
         )
  INTO v_cohort, v_activated
  FROM profiles
  WHERE NOT is_test_account AND created_at > v_period_start;

  -- ── Profile completion (absolute) ─────────────────────────────────────
  SELECT COUNT(*) INTO v_total_non_test
  FROM profiles WHERE NOT is_test_account;

  SELECT COUNT(*) INTO v_profile_complete
  FROM profiles
  WHERE NOT is_test_account
    AND avatar_url IS NOT NULL
    AND bio IS NOT NULL AND bio != '';

  -- ── Participation (7d, independent of p_days) ─────────────────────────
  SELECT COUNT(DISTINCT ued.user_id) INTO v_wau
  FROM user_engagement_daily ued
  JOIN profiles p ON p.id = ued.user_id
  WHERE ued.date > CURRENT_DATE - 7 AND NOT p.is_test_account;

  WITH creators AS (
    SELECT author_id AS user_id FROM user_posts
      WHERE created_at > now() - INTERVAL '7 days' AND deleted_at IS NULL
    UNION
    SELECT user_id FROM gallery_photos WHERE created_at > now() - INTERVAL '7 days'
    UNION
    SELECT user_id FROM player_videos WHERE created_at > now() - INTERVAL '7 days'
    UNION
    SELECT author_profile_id FROM profile_comments WHERE created_at > now() - INTERVAL '7 days'
    UNION
    SELECT sender_id FROM messages WHERE sent_at > now() - INTERVAL '7 days'
    UNION
    SELECT club_id FROM opportunities WHERE created_at > now() - INTERVAL '7 days'
  )
  SELECT COUNT(DISTINCT c.user_id) INTO v_contributors_7d
  FROM creators c
  JOIN profiles p ON p.id = c.user_id
  WHERE NOT p.is_test_account;

  -- ── Content creation (7d) ─────────────────────────────────────────────
  SELECT COUNT(*) INTO v_photos_7d FROM gallery_photos g
    JOIN profiles p ON p.id = g.user_id
    WHERE g.created_at > now() - INTERVAL '7 days' AND NOT p.is_test_account;
  SELECT COUNT(*) INTO v_videos_7d FROM player_videos v
    JOIN profiles p ON p.id = v.user_id
    WHERE v.created_at > now() - INTERVAL '7 days' AND NOT p.is_test_account;
  SELECT COUNT(*) INTO v_posts_7d FROM user_posts up
    JOIN profiles p ON p.id = up.author_id
    WHERE up.created_at > now() - INTERVAL '7 days' AND up.deleted_at IS NULL
      AND NOT p.is_test_account;
  SELECT COUNT(*) INTO v_opps_7d FROM opportunities o
    JOIN profiles p ON p.id = o.club_id
    WHERE o.created_at > now() - INTERVAL '7 days' AND NOT p.is_test_account;
  SELECT COUNT(*) INTO v_comments_7d FROM profile_comments c
    JOIN profiles p ON p.id = c.author_profile_id
    WHERE c.created_at > now() - INTERVAL '7 days' AND NOT p.is_test_account;
  SELECT COUNT(*) INTO v_messages_7d FROM messages m
    JOIN profiles p ON p.id = m.sender_id
    WHERE m.sent_at > now() - INTERVAL '7 days' AND NOT p.is_test_account;

  -- ── North star: real connections (p_days window) ──────────────────────
  -- Conversations started by a club/coach where the other side is a player,
  -- with the recruiter sending the first message.
  WITH club_started AS (
    SELECT c.id,
           CASE WHEN p1.role IN ('club','coach') THEN c.participant_two_id
                ELSE c.participant_one_id END AS player_id
    FROM conversations c
    JOIN profiles p1 ON p1.id = c.participant_one_id
    JOIN profiles p2 ON p2.id = c.participant_two_id
    CROSS JOIN LATERAL (
      SELECT m.sender_id FROM messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.sent_at ASC LIMIT 1
    ) first_msg
    WHERE c.created_at > v_period_start
      AND NOT p1.is_test_account AND NOT p2.is_test_account
      AND (
        (p1.role IN ('club','coach') AND p2.role = 'player' AND first_msg.sender_id = c.participant_one_id)
        OR
        (p2.role IN ('club','coach') AND p1.role = 'player' AND first_msg.sender_id = c.participant_two_id)
      )
  )
  SELECT COUNT(*), COUNT(DISTINCT player_id)
  INTO v_club_convos, v_players_contacted
  FROM club_started;

  SELECT COUNT(*) INTO v_shortlists
  FROM opportunity_applications oa
  JOIN profiles applicant ON applicant.id = oa.applicant_id
  JOIN opportunities o ON o.id = oa.opportunity_id
  JOIN profiles club ON club.id = o.club_id
  WHERE oa.status = 'shortlisted'
    AND oa.updated_at > v_period_start
    AND NOT applicant.is_test_account AND NOT club.is_test_account;

  SELECT COUNT(*), COALESCE(SUM(join_count), 0)
  INTO v_invites_sent, v_invite_joins
  FROM club_invite_links l
  JOIN profiles p ON p.id = l.club_profile_id
  WHERE l.created_at > v_period_start AND NOT p.is_test_account;

  SELECT COUNT(*) FILTER (WHERE o.closed_at > v_period_start),
         COUNT(*)
  INTO v_filled_period, v_filled_all_time
  FROM opportunities o
  JOIN profiles p ON p.id = o.club_id
  WHERE (o.closed_reason = 'filled' OR o.filled_via_hockia)
    AND NOT p.is_test_account;

  SELECT json_build_object(
    'new_users_period', v_new_users,
    'new_users_prev', v_new_users_prev,
    'activation_cohort', v_cohort,
    'activation_activated', v_activated,
    'activation_pct', CASE WHEN v_cohort > 0
      THEN ROUND(v_activated::NUMERIC / v_cohort * 100, 1) ELSE 0 END,
    'profiles_complete', v_profile_complete,
    'profiles_total', v_total_non_test,
    'profile_completion_pct', CASE WHEN v_total_non_test > 0
      THEN ROUND(v_profile_complete::NUMERIC / v_total_non_test * 100, 1) ELSE 0 END,
    'wau', v_wau,
    'contributors_7d', v_contributors_7d,
    'contributor_pct', CASE WHEN v_wau > 0
      THEN ROUND(v_contributors_7d::NUMERIC / v_wau * 100, 1) ELSE 0 END,
    'content_7d', json_build_object(
      'photos', v_photos_7d,
      'videos', v_videos_7d,
      'posts', v_posts_7d,
      'opportunities', v_opps_7d,
      'comments', v_comments_7d,
      'messages', v_messages_7d
    ),
    'north_star', json_build_object(
      'players_contacted', v_players_contacted,
      'club_conversations', v_club_convos,
      'applications', (
        SELECT COUNT(*)
        FROM opportunity_applications oa
        JOIN profiles applicant ON applicant.id = oa.applicant_id
        JOIN opportunities o ON o.id = oa.opportunity_id
        JOIN profiles club ON club.id = o.club_id
        WHERE oa.applied_at > v_period_start
          AND NOT applicant.is_test_account AND NOT club.is_test_account
      ),
      'shortlists', v_shortlists,
      'invites_sent', v_invites_sent,
      'invite_joins', v_invite_joins,
      'filled_period', v_filled_period,
      'filled_all_time', v_filled_all_time
    ),
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_engagement_overview(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_engagement_overview(integer) TO authenticated;
