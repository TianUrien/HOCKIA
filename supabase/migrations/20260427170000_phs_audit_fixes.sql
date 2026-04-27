-- ============================================================================
-- Product Health Score — round-2 audit fixes
-- ============================================================================
-- Two real correctness bugs found in a deeper audit pass:
--
-- 1. Activation cohort bias
--    The cohort included signups from the last 30 days. But signups < 7
--    days old have not had their full 7-day activation window elapse —
--    they cannot have triggered an HVE on day 6 of their lifetime if
--    they only signed up 1 day ago. The result was a downward-biased
--    activation rate (artificially "low" because we counted users who
--    legitimately still had time to activate).
--
--    Fix: cap cohort upper bound at now() - 7 days so we only score
--    signups whose 7-day window has fully elapsed.
--
-- 2. Test-account leakage
--    The opportunity / application / reference / tier-5-6 queries did
--    not exclude test accounts. Today's prod has no test accounts of
--    those types, so the score isn't inflated yet — but the moment a
--    test club posts an opportunity or a test player applies, the
--    score moves. Defense in depth: every count joins to profiles
--    and excludes test accounts.
--
-- Same function shape; only the queries change.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.compute_product_health_score()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_now_ts          TIMESTAMPTZ := timezone('utc', now());
  v_window_30d      TIMESTAMPTZ := v_now_ts - INTERVAL '30 days';
  v_window_7d       TIMESTAMPTZ := v_now_ts - INTERVAL '7 days';
  -- Activation cohort cutoff: only count signups whose 7-day window has
  -- fully elapsed. Without this, signups < 7 days old drag the rate
  -- down (they haven't had their fair shot at activating yet).
  v_activation_cutoff TIMESTAMPTZ := v_now_ts - INTERVAL '7 days';
  v_total_real_profiles INT;
  v_active_users_7d     INT;
  v_active_users_30d    INT;
  v_opp_count_30d        INT;
  v_opp_with_view        INT;
  v_opp_with_application INT;
  v_apps_total_30d       INT;
  v_apps_reviewed_30d    INT;
  v_apps_club_messaged   INT;
  v_apps_applicant_replied INT;
  v_recruitment_score    NUMERIC;
  v_recip_cross_role_7d  INT;
  v_recip_same_role_7d   INT;
  v_friendships_30d      INT;
  v_refs_accepted_30d    INT;
  v_friend_accept_rate   NUMERIC;
  v_network_score        NUMERIC;
  v_meaningful_w1        NUMERIC;
  v_meaningful_w4        NUMERIC;
  v_dau_mau_stickiness   NUMERIC;
  v_hv_actions_per_user  NUMERIC;
  v_retention_score      NUMERIC;
  v_role_balance_score   NUMERIC;
  v_lowest_role_pct      NUMERIC;
  v_cross_role_pct       NUMERIC;
  v_role_evenness        NUMERIC;
  v_signups_eligible     INT;  -- signups with full 7d window elapsed
  v_activated_in_7d      INT;
  v_activation_score     NUMERIC;
  v_posts_per_user       NUMERIC;
  v_posts_with_comment   NUMERIC;
  v_refs_given_per_user  NUMERIC;
  v_content_score        NUMERIC;
  v_high_value_events TEXT[] := ARRAY['message_send','application_submit','friend_request_send','opportunity_create','applicant_status_change','conversation_start','post_create'];
  v_overall_score        NUMERIC;
  v_payload              JSONB;
BEGIN
  -- Baseline
  SELECT COUNT(*) INTO v_total_real_profiles FROM profiles WHERE is_test_account IS NOT TRUE AND COALESCE(is_blocked, false) = false;
  SELECT COUNT(DISTINCT ued.user_id) INTO v_active_users_7d FROM user_engagement_daily ued JOIN profiles p ON p.id = ued.user_id WHERE ued.date > CURRENT_DATE - 7 AND p.is_test_account IS NOT TRUE;
  SELECT COUNT(DISTINCT ued.user_id) INTO v_active_users_30d FROM user_engagement_daily ued JOIN profiles p ON p.id = ued.user_id WHERE ued.date > CURRENT_DATE - 30 AND p.is_test_account IS NOT TRUE;

  -- Recruitment tiers 1-4 — NOW with test-account filter on club + applicant
  SELECT COUNT(*) INTO v_opp_count_30d
  FROM opportunities o
  JOIN profiles cp ON cp.id = o.club_id
  WHERE o.published_at > v_window_30d
    AND o.status IN ('open','closed')
    AND cp.is_test_account IS NOT TRUE;

  SELECT COUNT(DISTINCT o.id) INTO v_opp_with_view
  FROM opportunities o
  JOIN profiles cp ON cp.id = o.club_id
  WHERE o.published_at > v_window_30d
    AND o.status IN ('open','closed')
    AND cp.is_test_account IS NOT TRUE
    AND EXISTS (
      SELECT 1 FROM events e
      JOIN profiles vp ON vp.id = e.user_id
      WHERE e.event_name='vacancy_view'
        AND e.entity_id = o.id
        AND vp.is_test_account IS NOT TRUE
        AND vp.role IN ('player','coach')
    );

  SELECT COUNT(DISTINCT a.opportunity_id) INTO v_opp_with_application
  FROM opportunity_applications a
  JOIN opportunities o ON o.id = a.opportunity_id
  JOIN profiles cp ON cp.id = o.club_id
  JOIN profiles ap ON ap.id = a.applicant_id
  WHERE o.published_at > v_window_30d
    AND o.status IN ('open','closed')
    AND cp.is_test_account IS NOT TRUE
    AND ap.is_test_account IS NOT TRUE;

  SELECT COUNT(*) INTO v_apps_total_30d
  FROM opportunity_applications a
  JOIN opportunities o ON o.id = a.opportunity_id
  JOIN profiles cp ON cp.id = o.club_id
  JOIN profiles ap ON ap.id = a.applicant_id
  WHERE o.published_at > v_window_30d
    AND cp.is_test_account IS NOT TRUE
    AND ap.is_test_account IS NOT TRUE;

  SELECT COUNT(*) INTO v_apps_reviewed_30d
  FROM opportunity_applications a
  JOIN opportunities o ON o.id = a.opportunity_id
  JOIN profiles cp ON cp.id = o.club_id
  JOIN profiles ap ON ap.id = a.applicant_id
  WHERE o.published_at > v_window_30d
    AND a.status IS NOT NULL
    AND a.status <> 'pending'
    AND cp.is_test_account IS NOT TRUE
    AND ap.is_test_account IS NOT TRUE;

  -- Tier 5: club sent a message to applicant within 7d
  SELECT COUNT(DISTINCT a.id) INTO v_apps_club_messaged
  FROM opportunity_applications a
  JOIN opportunities o ON o.id = a.opportunity_id
  JOIN profiles cp ON cp.id = o.club_id
  JOIN profiles ap ON ap.id = a.applicant_id
  JOIN conversations c ON
       (c.participant_one_id = o.club_id AND c.participant_two_id = a.applicant_id)
    OR (c.participant_one_id = a.applicant_id AND c.participant_two_id = o.club_id)
  WHERE o.published_at > v_window_30d
    AND cp.is_test_account IS NOT TRUE
    AND ap.is_test_account IS NOT TRUE
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.conversation_id = c.id
        AND m.sender_id = o.club_id
        AND m.sent_at >= a.applied_at
        AND m.sent_at <= a.applied_at + INTERVAL '7 days'
    );

  -- Tier 6: applicant replied AFTER club's first message
  SELECT COUNT(DISTINCT a.id) INTO v_apps_applicant_replied
  FROM opportunity_applications a
  JOIN opportunities o ON o.id = a.opportunity_id
  JOIN profiles cp ON cp.id = o.club_id
  JOIN profiles ap ON ap.id = a.applicant_id
  JOIN conversations c ON
       (c.participant_one_id = o.club_id AND c.participant_two_id = a.applicant_id)
    OR (c.participant_one_id = a.applicant_id AND c.participant_two_id = o.club_id)
  WHERE o.published_at > v_window_30d
    AND cp.is_test_account IS NOT TRUE
    AND ap.is_test_account IS NOT TRUE
    AND EXISTS (
      SELECT 1
      FROM messages m_club
      JOIN messages m_reply ON m_reply.conversation_id = m_club.conversation_id
      WHERE m_club.conversation_id = c.id
        AND m_club.sender_id = o.club_id
        AND m_club.sent_at >= a.applied_at
        AND m_club.sent_at <= a.applied_at + INTERVAL '7 days'
        AND m_reply.sender_id = a.applicant_id
        AND m_reply.sent_at  > m_club.sent_at
    );

  v_recruitment_score := COALESCE(
    public._phs_normalize(CASE WHEN v_opp_count_30d=0 THEN 0 ELSE 100.0*v_opp_with_view/v_opp_count_30d END, 80) * 0.15 +
    public._phs_normalize(CASE WHEN v_opp_count_30d=0 THEN 0 ELSE 100.0*v_opp_with_application/v_opp_count_30d END, 60) * 0.25 +
    public._phs_normalize(CASE WHEN v_apps_total_30d=0 THEN 0 ELSE 100.0*v_apps_reviewed_30d/v_apps_total_30d END, 50) * 0.20 +
    public._phs_normalize(CASE WHEN v_apps_reviewed_30d=0 THEN 0 ELSE 100.0*v_apps_club_messaged/v_apps_reviewed_30d END, 60) * 0.20 +
    public._phs_normalize(CASE WHEN v_apps_club_messaged=0 THEN 0 ELSE 100.0*v_apps_applicant_replied/v_apps_club_messaged END, 60) * 0.15 +
    public._phs_normalize(v_opp_count_30d, 3) * 0.05,
    0
  );

  -- Network loop (Phase 1 already filters test accounts on participants)
  WITH conv_recip AS (SELECT c.id, p1.role <> p2.role AS is_cross_role, (SELECT COUNT(DISTINCT m.sender_id) FROM messages m WHERE m.conversation_id = c.id AND m.sent_at > v_window_7d) AS distinct_senders FROM conversations c JOIN profiles p1 ON p1.id = c.participant_one_id JOIN profiles p2 ON p2.id = c.participant_two_id WHERE c.last_message_at > v_window_7d AND p1.is_test_account IS NOT TRUE AND p2.is_test_account IS NOT TRUE) SELECT COUNT(*) FILTER (WHERE distinct_senders >= 2 AND is_cross_role), COUNT(*) FILTER (WHERE distinct_senders >= 2 AND NOT is_cross_role) INTO v_recip_cross_role_7d, v_recip_same_role_7d FROM conv_recip;
  SELECT COUNT(*) INTO v_friendships_30d FROM profile_friendships f JOIN profiles p1 ON p1.id = f.user_one JOIN profiles p2 ON p2.id = f.user_two WHERE f.status='accepted' AND f.accepted_at > v_window_30d AND p1.is_test_account IS NOT TRUE AND p2.is_test_account IS NOT TRUE;

  -- References — NOW filtering test accounts on both ends
  SELECT COUNT(*) INTO v_refs_accepted_30d
  FROM profile_references r
  JOIN profiles rq ON rq.id = r.requester_id
  JOIN profiles rf ON rf.id = r.reference_id
  WHERE r.status='accepted'
    AND r.accepted_at > v_window_30d
    AND COALESCE(LENGTH(TRIM(r.endorsement_text)),0) > 0
    AND rq.is_test_account IS NOT TRUE
    AND rf.is_test_account IS NOT TRUE;

  SELECT CASE WHEN COUNT(*) FILTER (WHERE status IN ('accepted','rejected'))=0 THEN 0 ELSE 100.0*COUNT(*) FILTER (WHERE status='accepted')/COUNT(*) FILTER (WHERE status IN ('accepted','rejected')) END INTO v_friend_accept_rate FROM profile_friendships WHERE updated_at > v_window_30d;
  v_network_score := COALESCE(public._phs_normalize(CASE WHEN v_active_users_7d=0 THEN 0 ELSE v_recip_cross_role_7d::NUMERIC/v_active_users_7d END, 0.30) * 0.35 + public._phs_normalize(CASE WHEN v_active_users_7d=0 THEN 0 ELSE v_recip_same_role_7d::NUMERIC/v_active_users_7d END, 0.50) * 0.15 + public._phs_normalize(CASE WHEN v_active_users_30d=0 THEN 0 ELSE v_friendships_30d::NUMERIC/v_active_users_30d END, 1.5) * 0.15 + public._phs_normalize(v_refs_accepted_30d, 5) * 0.25 + public._phs_normalize(v_friend_accept_rate, 70) * 0.10, 0);

  -- Retention loop (unchanged)
  WITH cohort_w1 AS (SELECT p.id AS user_id, p.created_at FROM profiles p WHERE p.is_test_account IS NOT TRUE AND p.created_at >= CURRENT_DATE - INTERVAL '14 days' AND p.created_at < CURRENT_DATE - INTERVAL '7 days' AND p.onboarding_completed = true), retained AS (SELECT DISTINCT c.user_id FROM cohort_w1 c JOIN events e ON e.user_id = c.user_id WHERE e.event_name = ANY(v_high_value_events) AND e.created_at >= c.created_at + INTERVAL '7 days' AND e.created_at < c.created_at + INTERVAL '14 days') SELECT CASE WHEN (SELECT COUNT(*) FROM cohort_w1)=0 THEN NULL ELSE 100.0*(SELECT COUNT(*) FROM retained)/(SELECT COUNT(*) FROM cohort_w1) END INTO v_meaningful_w1;
  WITH cohort_w4 AS (SELECT p.id AS user_id, p.created_at FROM profiles p WHERE p.is_test_account IS NOT TRUE AND p.created_at >= CURRENT_DATE - INTERVAL '35 days' AND p.created_at < CURRENT_DATE - INTERVAL '28 days' AND p.onboarding_completed = true), retained AS (SELECT DISTINCT c.user_id FROM cohort_w4 c JOIN events e ON e.user_id = c.user_id WHERE e.event_name = ANY(v_high_value_events) AND e.created_at >= c.created_at + INTERVAL '28 days' AND e.created_at < c.created_at + INTERVAL '35 days') SELECT CASE WHEN (SELECT COUNT(*) FROM cohort_w4)=0 THEN NULL ELSE 100.0*(SELECT COUNT(*) FROM retained)/(SELECT COUNT(*) FROM cohort_w4) END INTO v_meaningful_w4;
  SELECT CASE WHEN v_active_users_30d=0 THEN 0 ELSE (SELECT ROUND(AVG(daily_users)::NUMERIC, 4) FROM (SELECT date, COUNT(DISTINCT user_id) AS daily_users FROM user_engagement_daily WHERE date > CURRENT_DATE - 30 GROUP BY date) sub) / v_active_users_30d END INTO v_dau_mau_stickiness;
  SELECT CASE WHEN v_active_users_7d=0 THEN 0 ELSE (SELECT COUNT(*)::NUMERIC FROM events e JOIN profiles p ON p.id = e.user_id WHERE e.event_name = ANY(v_high_value_events) AND e.created_at > v_window_7d AND p.is_test_account IS NOT TRUE) / v_active_users_7d END INTO v_hv_actions_per_user;
  v_retention_score := COALESCE(public._phs_normalize(COALESCE(v_meaningful_w1, 0), 30) * 0.35 + public._phs_normalize(COALESCE(v_meaningful_w4, 0), 15) * 0.35 + public._phs_normalize(v_dau_mau_stickiness, 0.20) * 0.15 + public._phs_normalize(v_hv_actions_per_user, 2.0) * 0.15, 0);

  -- Role balance — explicit NULL-role exclusion, defensive
  WITH role_actions AS (
    SELECT p.role, COUNT(*) AS hv_count
    FROM events e JOIN profiles p ON p.id = e.user_id
    WHERE e.event_name = ANY(v_high_value_events)
      AND e.created_at > v_window_7d
      AND p.is_test_account IS NOT TRUE
      AND p.role IS NOT NULL
    GROUP BY p.role
  ), totals AS (SELECT COALESCE(SUM(hv_count), 0) AS total_hv FROM role_actions),
     shares AS (SELECT r.role, r.hv_count, CASE WHEN t.total_hv=0 THEN 0 ELSE 100.0*r.hv_count/t.total_hv END AS pct FROM role_actions r CROSS JOIN totals t)
  SELECT COALESCE((SELECT MIN(pct) FROM shares), 0),
         CASE WHEN (SELECT COUNT(*) FROM shares) <= 1 THEN 0
              ELSE 1.0 - ((SELECT MAX(pct) FROM shares) - (SELECT MIN(pct) FROM shares))
                          / NULLIF((SELECT MAX(pct) FROM shares) + (SELECT MIN(pct) FROM shares), 0)
         END
  INTO v_lowest_role_pct, v_role_evenness;
  SELECT CASE WHEN v_recip_cross_role_7d + v_recip_same_role_7d = 0 THEN 0 ELSE 100.0 * v_recip_cross_role_7d::NUMERIC / (v_recip_cross_role_7d + v_recip_same_role_7d) END INTO v_cross_role_pct;
  v_role_balance_score := COALESCE(public._phs_normalize(v_lowest_role_pct, 5) * 0.50 + public._phs_normalize(v_cross_role_pct, 30) * 0.30 + public._phs_normalize(v_role_evenness * 100, 70) * 0.20, 0);

  -- Activation — FIXED COHORT: only signups whose 7d window has elapsed
  SELECT COUNT(*) INTO v_signups_eligible
  FROM profiles
  WHERE is_test_account IS NOT TRUE
    AND created_at > v_window_30d
    AND created_at <= v_activation_cutoff
    AND onboarding_completed = true;

  SELECT COUNT(DISTINCT p.id) INTO v_activated_in_7d
  FROM profiles p
  WHERE p.is_test_account IS NOT TRUE
    AND p.created_at > v_window_30d
    AND p.created_at <= v_activation_cutoff
    AND p.onboarding_completed = true
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.user_id = p.id
        AND e.event_name = ANY(v_high_value_events)
        AND e.created_at >= p.created_at
        AND e.created_at <  p.created_at + INTERVAL '7 days'
    );

  v_activation_score := COALESCE(
    public._phs_normalize(
      CASE WHEN v_signups_eligible=0 THEN 0 ELSE 100.0*v_activated_in_7d/v_signups_eligible END,
      50
    ),
    0
  );

  -- Content (unchanged)
  SELECT CASE WHEN v_active_users_7d=0 THEN 0 ELSE (SELECT COUNT(*)::NUMERIC FROM user_posts up JOIN profiles p ON p.id = up.author_id WHERE up.created_at > v_window_7d AND up.deleted_at IS NULL AND p.is_test_account IS NOT TRUE) / v_active_users_7d END INTO v_posts_per_user;
  WITH posts AS (SELECT up.id FROM user_posts up JOIN profiles p ON p.id = up.author_id WHERE up.created_at > v_window_30d AND up.deleted_at IS NULL AND p.is_test_account IS NOT TRUE) SELECT CASE WHEN (SELECT COUNT(*) FROM posts)=0 THEN 0 ELSE 100.0*(SELECT COUNT(DISTINCT post_id) FROM post_comments pc WHERE pc.post_id IN (SELECT id FROM posts) AND pc.deleted_at IS NULL)/(SELECT COUNT(*) FROM posts) END INTO v_posts_with_comment;
  SELECT CASE WHEN v_active_users_30d=0 THEN 0 ELSE v_refs_accepted_30d::NUMERIC / v_active_users_30d END INTO v_refs_given_per_user;
  v_content_score := COALESCE(public._phs_normalize(v_posts_per_user, 0.30) * 0.30 + public._phs_normalize(v_posts_with_comment, 30) * 0.40 + public._phs_normalize(v_refs_given_per_user, 0.20) * 0.30, 0);

  v_overall_score := ROUND(v_recruitment_score*0.30 + v_network_score*0.25 + v_retention_score*0.20 + v_role_balance_score*0.10 + v_activation_score*0.10 + v_content_score*0.05, 1);

  v_payload := jsonb_build_object(
    'overall_score', v_overall_score,
    'tier', CASE WHEN v_overall_score>=80 THEN 'excellent' WHEN v_overall_score>=60 THEN 'working' WHEN v_overall_score>=40 THEN 'building' WHEN v_overall_score>=20 THEN 'weak' ELSE 'critical' END,
    'computed_at', v_now_ts,
    'window', '30d / 7d',
    'sub_scores', jsonb_build_object(
      'recruitment', jsonb_build_object('score', ROUND(v_recruitment_score, 1), 'weight', 0.30),
      'network', jsonb_build_object('score', ROUND(v_network_score, 1), 'weight', 0.25),
      'retention', jsonb_build_object('score', ROUND(v_retention_score, 1), 'weight', 0.20),
      'role_balance', jsonb_build_object('score', ROUND(v_role_balance_score, 1), 'weight', 0.10),
      'activation', jsonb_build_object('score', ROUND(v_activation_score, 1), 'weight', 0.10),
      'content', jsonb_build_object('score', ROUND(v_content_score, 1), 'weight', 0.05)
    ),
    'diagnostics', jsonb_build_object(
      'baseline', jsonb_build_object(
        'real_profiles', v_total_real_profiles,
        'active_users_7d', v_active_users_7d,
        'active_users_30d', v_active_users_30d
      ),
      'recruitment', jsonb_build_object(
        'opportunities_30d', v_opp_count_30d,
        'opportunities_with_view', v_opp_with_view,
        'opportunities_with_apps', v_opp_with_application,
        'applications_30d', v_apps_total_30d,
        'applications_reviewed_30d', v_apps_reviewed_30d,
        'applications_club_messaged_30d', v_apps_club_messaged,
        'applications_applicant_replied_30d', v_apps_applicant_replied,
        'tiers_5_6_measured', true
      ),
      'network', jsonb_build_object(
        'reciprocal_cross_role_7d', v_recip_cross_role_7d,
        'reciprocal_same_role_7d', v_recip_same_role_7d,
        'friendships_accepted_30d', v_friendships_30d,
        'references_accepted_30d', v_refs_accepted_30d,
        'friend_accept_rate_pct', ROUND(v_friend_accept_rate, 1)
      ),
      'retention', jsonb_build_object(
        'meaningful_w1_pct', ROUND(COALESCE(v_meaningful_w1, 0), 1),
        'meaningful_w4_pct', ROUND(COALESCE(v_meaningful_w4, 0), 1),
        'dau_mau_stickiness', ROUND(v_dau_mau_stickiness, 3),
        'hv_actions_per_user_7d', ROUND(v_hv_actions_per_user, 2),
        'w1_cohort_known', v_meaningful_w1 IS NOT NULL,
        'w4_cohort_known', v_meaningful_w4 IS NOT NULL
      ),
      'role_balance', jsonb_build_object(
        'lowest_role_pct', ROUND(v_lowest_role_pct, 1),
        'cross_role_interaction_pct', ROUND(v_cross_role_pct, 1),
        'evenness', ROUND(v_role_evenness, 3)
      ),
      'activation', jsonb_build_object(
        'signups_30d', v_signups_eligible,
        'activated_in_7d', v_activated_in_7d,
        'activation_rate_pct', CASE WHEN v_signups_eligible=0 THEN NULL ELSE ROUND(100.0*v_activated_in_7d/v_signups_eligible, 1) END,
        -- Phase 2.1: explicit cohort note so UI can explain
        'cohort_cutoff_days', 7,
        'cohort_excluded_recent_signups', true
      ),
      'content', jsonb_build_object(
        'posts_per_active_user_7d', ROUND(v_posts_per_user, 3),
        'posts_with_comment_pct', ROUND(v_posts_with_comment, 1),
        'refs_given_per_user_30d', ROUND(v_refs_given_per_user, 3),
        'low_data_confidence', v_active_users_30d < 50
      )
    ),
    'bottleneck', (
      SELECT jsonb_build_object('loop', loop, 'score', score, 'weight', weight)
      FROM (VALUES
        ('recruitment', v_recruitment_score, 0.30),
        ('network', v_network_score, 0.25),
        ('retention', v_retention_score, 0.20),
        ('role_balance', v_role_balance_score, 0.10),
        ('activation', v_activation_score, 0.10),
        ('content', v_content_score, 0.05)
      ) AS t(loop, score, weight)
      ORDER BY (100 - score) * weight DESC, weight DESC, loop ASC
      LIMIT 1
    )
  );

  RETURN v_payload;
END;
$func$;

COMMENT ON FUNCTION public.compute_product_health_score IS
  'Phase 2.1: audit fixes — activation cohort cutoff (only 7d-elapsed signups counted) + test-account filtering on opportunities/applications/references/tier-5-6 queries + explicit NULL-role exclusion on role_balance + deterministic bottleneck tiebreak (weight DESC, then loop name ASC).';
