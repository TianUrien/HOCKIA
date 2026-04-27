-- ============================================================================
-- HOCKIA Product Health Score (Phase 1)
-- ============================================================================
-- Single 0-100 score answering: "Is HOCKIA actually creating real hockey
-- value between roles?" Built from six core loop sub-scores. Strict by
-- design — passive activity (logins, profile views, likes, browsing)
-- contributes near-zero. Score weight is concentrated in value-producing
-- loops: Recruitment (30%) + Network (25%) + Retention (20%) = 75%.
--
-- Loop weights:
--   Recruitment   30%   opportunity → view → application → review
--                       (Tiers 5–6 club-message and reply deferred to
--                       Phase 2 — measured tiers max out the loop at the
--                       4-of-6 honest cap)
--   Network       25%   reciprocal cross-role conversations + accepted
--                       friendships + accepted references
--   Retention     20%   meaningful W1/W4 cohort retention from
--                       user_engagement_daily, gated on high-value action
--   Role Balance  10%   all 5 roles meaningfully participating; lowest
--                       role floors the loop
--   Activation    10%   role-specific 7-day activation
--   Content/Live   5%   posts that drive engagement, references given
--
-- Tier thresholds:
--    0–19  Critical    basic loops not firing
--   20–39  Weak        some signal but loops barely close
--   40–59  Building    identifiable bottlenecks; viable trajectory
--   60–79  Working     loops closing routinely
--   80–100 Excellent   PMF territory
--
-- At ~200 users the score will read honestly low (likely 25–35).
-- That's the truthful starting line — the metric we optimize is the trend.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- helper: normalize a metric to 0–100 using a piecewise linear curve
-- ----------------------------------------------------------------------------
-- value: the raw metric
-- target: the value that should map to 100
-- floor:  the value at or below which the score is 0 (default 0)
-- Linear between floor and target, capped at 100 above target.
CREATE OR REPLACE FUNCTION public._phs_normalize(
  p_value NUMERIC,
  p_target NUMERIC,
  p_floor NUMERIC DEFAULT 0
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR p_value <= p_floor THEN 0
    WHEN p_value >= p_target THEN 100
    ELSE ROUND(((p_value - p_floor) / NULLIF(p_target - p_floor, 0)) * 100, 1)
  END;
$$;

COMMENT ON FUNCTION public._phs_normalize IS
  'Maps a raw metric to 0–100 via piecewise-linear scaling against a target. Used by compute_product_health_score sub-score math.';

-- ============================================================================
-- main: compute_product_health_score
-- ============================================================================
CREATE OR REPLACE FUNCTION public.compute_product_health_score()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Time windows
  v_now_ts          TIMESTAMPTZ := timezone('utc', now());
  v_window_30d      TIMESTAMPTZ := v_now_ts - INTERVAL '30 days';
  v_window_7d       TIMESTAMPTZ := v_now_ts - INTERVAL '7 days';

  -- Reusable counts
  v_total_real_profiles INT;
  v_active_users_7d     INT;
  v_active_users_30d    INT;

  -- Recruitment loop
  v_opp_count_30d        INT;
  v_opp_with_view        INT;
  v_opp_with_application INT;
  v_apps_total_30d       INT;
  v_apps_reviewed_30d    INT;  -- status moved off 'pending'
  v_recruitment_score    NUMERIC;

  -- Network loop
  v_recip_cross_role_7d  INT;
  v_recip_same_role_7d   INT;
  v_friendships_30d      INT;
  v_refs_accepted_30d    INT;
  v_friend_accept_rate   NUMERIC;
  v_network_score        NUMERIC;

  -- Retention loop
  v_meaningful_w1        NUMERIC;  -- meaningful return rate, week+1
  v_meaningful_w4        NUMERIC;  -- meaningful return rate, week+4
  v_dau_mau_stickiness   NUMERIC;
  v_hv_actions_per_user  NUMERIC;
  v_retention_score      NUMERIC;

  -- Role balance loop
  v_role_balance_score   NUMERIC;
  v_lowest_role_pct      NUMERIC;
  v_cross_role_pct       NUMERIC;
  v_role_evenness        NUMERIC;

  -- Activation loop
  v_signups_30d          INT;
  v_activated_in_7d      INT;
  v_activation_score     NUMERIC;

  -- Content/liveness loop
  v_posts_per_user       NUMERIC;
  v_posts_with_comment   NUMERIC;
  v_refs_given_per_user  NUMERIC;
  v_content_score        NUMERIC;

  -- High-value events list (used in retention + role balance)
  v_high_value_events TEXT[] := ARRAY[
    'message_send', 'application_submit', 'friend_request_send',
    'opportunity_create', 'applicant_status_change',
    'conversation_start', 'post_create'
  ];

  -- Final assembly
  v_overall_score        NUMERIC;
  v_payload              JSONB;
BEGIN
  -- ============================================================================
  -- Baselines
  -- ============================================================================
  SELECT COUNT(*) INTO v_total_real_profiles
  FROM profiles
  WHERE is_test_account IS NOT TRUE
    AND COALESCE(is_blocked, false) = false;

  SELECT COUNT(DISTINCT ued.user_id) INTO v_active_users_7d
  FROM user_engagement_daily ued
  JOIN profiles p ON p.id = ued.user_id
  WHERE ued.date > CURRENT_DATE - 7
    AND p.is_test_account IS NOT TRUE;

  SELECT COUNT(DISTINCT ued.user_id) INTO v_active_users_30d
  FROM user_engagement_daily ued
  JOIN profiles p ON p.id = ued.user_id
  WHERE ued.date > CURRENT_DATE - 30
    AND p.is_test_account IS NOT TRUE;

  -- ============================================================================
  -- A. Recruitment loop (30%)
  -- Tier 1 = posted, 2 = viewed by matching role, 3 = ≥1 application,
  -- 4 = ≥1 application reviewed (status off 'pending').
  -- Tiers 5–6 (club messages applicant → applicant replies) deferred to
  -- Phase 2; they would need a dedicated materialized view to compute
  -- efficiently. MVP measures the first 4 tiers honestly — the loop is
  -- weighted accordingly so it can reach 100 only when all 4 measurable
  -- tiers are firing well.
  -- ============================================================================

  -- Posted in last 30d (denominator for tiers 2 + 3)
  SELECT COUNT(*) INTO v_opp_count_30d
  FROM opportunities o
  WHERE o.published_at > v_window_30d
    AND o.status IN ('open', 'closed');

  -- Tier 2: opportunities that received ≥1 view from a matching role user
  SELECT COUNT(DISTINCT o.id) INTO v_opp_with_view
  FROM opportunities o
  WHERE o.published_at > v_window_30d
    AND o.status IN ('open', 'closed')
    AND EXISTS (
      SELECT 1 FROM events e
      JOIN profiles vp ON vp.id = e.user_id
      WHERE e.event_name = 'vacancy_view'
        AND e.entity_id = o.id
        AND vp.is_test_account IS NOT TRUE
        -- "matching role" = player or coach (the demand side of the marketplace)
        AND vp.role IN ('player', 'coach')
    );

  -- Tier 3: opportunities with ≥1 application
  SELECT COUNT(DISTINCT a.opportunity_id) INTO v_opp_with_application
  FROM opportunity_applications a
  JOIN opportunities o ON o.id = a.opportunity_id
  WHERE o.published_at > v_window_30d
    AND o.status IN ('open', 'closed');

  -- Tier 4: applications reviewed by club (status moved off 'pending')
  SELECT COUNT(*) INTO v_apps_total_30d
  FROM opportunity_applications a
  JOIN opportunities o ON o.id = a.opportunity_id
  WHERE o.published_at > v_window_30d;

  SELECT COUNT(*) INTO v_apps_reviewed_30d
  FROM opportunity_applications a
  JOIN opportunities o ON o.id = a.opportunity_id
  WHERE o.published_at > v_window_30d
    AND a.status IS NOT NULL
    AND a.status <> 'pending';

  -- Recruitment loop math:
  --   Tier 2 rate (weight 25%): % of posted opportunities that got ≥1 view
  --     target = 80% reach (most posted opps surface to demand side)
  --   Tier 3 rate (weight 35%): % of posted opportunities that got ≥1 application
  --     target = 60% application rate
  --   Tier 4 rate (weight 30%): % of applications reviewed
  --     target = 50% review rate
  --   Floor on volume (weight 10%): if no opportunities posted at all, the
  --     loop floors at 0; we award up to 100% credit if ≥3 opportunities
  --     posted in 30d (proxy for "marketplace alive at minimum")
  v_recruitment_score := COALESCE(
    public._phs_normalize(
      CASE WHEN v_opp_count_30d = 0 THEN 0
           ELSE 100.0 * v_opp_with_view / v_opp_count_30d END,
      80
    ) * 0.25 +
    public._phs_normalize(
      CASE WHEN v_opp_count_30d = 0 THEN 0
           ELSE 100.0 * v_opp_with_application / v_opp_count_30d END,
      60
    ) * 0.35 +
    public._phs_normalize(
      CASE WHEN v_apps_total_30d = 0 THEN 0
           ELSE 100.0 * v_apps_reviewed_30d / v_apps_total_30d END,
      50
    ) * 0.30 +
    public._phs_normalize(v_opp_count_30d, 3) * 0.10,
    0
  );

  -- ============================================================================
  -- B. Network loop (25%)
  -- Reciprocity > volume. Cross-role > same-role. Accepted-only handshakes.
  -- ============================================================================

  -- Reciprocal conversations: ≥2 distinct senders. Cross-role flag derived
  -- from participants. We use the last 7 days as the window for "alive
  -- network density" instead of 30d to capture freshness.
  WITH conv_recip AS (
    SELECT
      c.id,
      p1.role AS p1_role,
      p2.role AS p2_role,
      p1.role <> p2.role AS is_cross_role,
      (
        SELECT COUNT(DISTINCT m.sender_id)
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sent_at > v_window_7d
      ) AS distinct_senders
    FROM conversations c
    JOIN profiles p1 ON p1.id = c.participant_one_id
    JOIN profiles p2 ON p2.id = c.participant_two_id
    WHERE c.last_message_at > v_window_7d
      AND p1.is_test_account IS NOT TRUE
      AND p2.is_test_account IS NOT TRUE
  )
  SELECT
    COUNT(*) FILTER (WHERE distinct_senders >= 2 AND is_cross_role),
    COUNT(*) FILTER (WHERE distinct_senders >= 2 AND NOT is_cross_role)
  INTO v_recip_cross_role_7d, v_recip_same_role_7d
  FROM conv_recip;

  -- Accepted friendships in last 30d
  SELECT COUNT(*) INTO v_friendships_30d
  FROM profile_friendships f
  JOIN profiles p1 ON p1.id = f.user_one
  JOIN profiles p2 ON p2.id = f.user_two
  WHERE f.status = 'accepted'
    AND f.accepted_at > v_window_30d
    AND p1.is_test_account IS NOT TRUE
    AND p2.is_test_account IS NOT TRUE;

  -- Accepted references in last 30d (only with non-empty endorsement)
  SELECT COUNT(*) INTO v_refs_accepted_30d
  FROM profile_references r
  WHERE r.status = 'accepted'
    AND r.accepted_at > v_window_30d
    AND COALESCE(LENGTH(TRIM(r.endorsement_text)), 0) > 0;

  -- Friend request acceptance rate (accepted / total resolved)
  SELECT CASE
    WHEN COUNT(*) FILTER (WHERE status IN ('accepted', 'rejected')) = 0 THEN 0
    ELSE 100.0 * COUNT(*) FILTER (WHERE status = 'accepted')
         / COUNT(*) FILTER (WHERE status IN ('accepted', 'rejected'))
  END INTO v_friend_accept_rate
  FROM profile_friendships
  WHERE updated_at > v_window_30d;

  v_network_score := COALESCE(
    -- Cross-role reciprocal conversations per active user per week
    -- target 0.30 (heavy weight)
    public._phs_normalize(
      CASE WHEN v_active_users_7d = 0 THEN 0
           ELSE v_recip_cross_role_7d::NUMERIC / v_active_users_7d END,
      0.30
    ) * 0.35 +
    -- Same-role reciprocal conversations per active user per week
    -- target 0.50
    public._phs_normalize(
      CASE WHEN v_active_users_7d = 0 THEN 0
           ELSE v_recip_same_role_7d::NUMERIC / v_active_users_7d END,
      0.50
    ) * 0.15 +
    -- Accepted friendships per active user per month
    -- target 1.5
    public._phs_normalize(
      CASE WHEN v_active_users_30d = 0 THEN 0
           ELSE v_friendships_30d::NUMERIC / v_active_users_30d END,
      1.5
    ) * 0.15 +
    -- Accepted references per month — target 5
    public._phs_normalize(v_refs_accepted_30d, 5) * 0.25 +
    -- Friend request acceptance rate — target 70%
    public._phs_normalize(v_friend_accept_rate, 70) * 0.10,
    0
  );

  -- ============================================================================
  -- C. Retention loop (20%)
  -- "Meaningful retention" = returned AND performed ≥1 high-value action.
  -- Hollow returners (came back, only browsed/liked) get 0 credit.
  -- ============================================================================

  -- Meaningful W1 retention: of users who signed up between week_n-2 and
  -- week_n-1 (i.e. their week-1 = last week), what fraction of them
  -- triggered a high-value event in their week-1?
  WITH cohort_w1 AS (
    SELECT p.id AS user_id, p.created_at
    FROM profiles p
    WHERE p.is_test_account IS NOT TRUE
      AND p.created_at >= CURRENT_DATE - INTERVAL '14 days'
      AND p.created_at <  CURRENT_DATE - INTERVAL '7 days'
      AND p.onboarding_completed = true
  ), retained AS (
    SELECT DISTINCT c.user_id
    FROM cohort_w1 c
    JOIN events e ON e.user_id = c.user_id
    WHERE e.event_name = ANY(v_high_value_events)
      AND e.created_at >= c.created_at + INTERVAL '7 days'
      AND e.created_at <  c.created_at + INTERVAL '14 days'
  )
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM cohort_w1) = 0 THEN NULL
    ELSE 100.0 * (SELECT COUNT(*) FROM retained) / (SELECT COUNT(*) FROM cohort_w1)
  END INTO v_meaningful_w1;

  -- Meaningful W4 retention
  WITH cohort_w4 AS (
    SELECT p.id AS user_id, p.created_at
    FROM profiles p
    WHERE p.is_test_account IS NOT TRUE
      AND p.created_at >= CURRENT_DATE - INTERVAL '35 days'
      AND p.created_at <  CURRENT_DATE - INTERVAL '28 days'
      AND p.onboarding_completed = true
  ), retained AS (
    SELECT DISTINCT c.user_id
    FROM cohort_w4 c
    JOIN events e ON e.user_id = c.user_id
    WHERE e.event_name = ANY(v_high_value_events)
      AND e.created_at >= c.created_at + INTERVAL '28 days'
      AND e.created_at <  c.created_at + INTERVAL '35 days'
  )
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM cohort_w4) = 0 THEN NULL
    ELSE 100.0 * (SELECT COUNT(*) FROM retained) / (SELECT COUNT(*) FROM cohort_w4)
  END INTO v_meaningful_w4;

  -- DAU/MAU stickiness (avg daily active over last 30d / monthly active)
  SELECT CASE
    WHEN v_active_users_30d = 0 THEN 0
    ELSE (
      SELECT ROUND(AVG(daily_users)::NUMERIC, 4)
      FROM (
        SELECT date, COUNT(DISTINCT user_id) AS daily_users
        FROM user_engagement_daily
        WHERE date > CURRENT_DATE - 30
        GROUP BY date
      ) sub
    ) / v_active_users_30d
  END INTO v_dau_mau_stickiness;

  -- High-value actions per active user per week (last 7d)
  SELECT CASE
    WHEN v_active_users_7d = 0 THEN 0
    ELSE (
      SELECT COUNT(*)::NUMERIC FROM events e
      JOIN profiles p ON p.id = e.user_id
      WHERE e.event_name = ANY(v_high_value_events)
        AND e.created_at > v_window_7d
        AND p.is_test_account IS NOT TRUE
    ) / v_active_users_7d
  END INTO v_hv_actions_per_user;

  -- Targets:
  --   Meaningful W1 retention: 30%
  --   Meaningful W4 retention: 15%
  --   DAU/MAU stickiness:       0.20
  --   High-value actions/user:  2.0
  v_retention_score := COALESCE(
    public._phs_normalize(COALESCE(v_meaningful_w1, 0), 30) * 0.35 +
    public._phs_normalize(COALESCE(v_meaningful_w4, 0), 15) * 0.35 +
    public._phs_normalize(v_dau_mau_stickiness, 0.20) * 0.15 +
    public._phs_normalize(v_hv_actions_per_user, 2.0) * 0.15,
    0
  );

  -- ============================================================================
  -- D. Role Balance loop (10%)
  -- Multi-sided marketplace check. If one role is silent, the loop floors.
  -- ============================================================================
  WITH role_actions AS (
    SELECT p.role, COUNT(*) AS hv_count
    FROM events e
    JOIN profiles p ON p.id = e.user_id
    WHERE e.event_name = ANY(v_high_value_events)
      AND e.created_at > v_window_7d
      AND p.is_test_account IS NOT TRUE
    GROUP BY p.role
  ), totals AS (
    SELECT
      COALESCE(SUM(hv_count), 0) AS total_hv,
      COUNT(*) AS roles_present
    FROM role_actions
  ), shares AS (
    SELECT
      r.role,
      r.hv_count,
      CASE WHEN t.total_hv = 0 THEN 0
           ELSE 100.0 * r.hv_count / t.total_hv
      END AS pct
    FROM role_actions r CROSS JOIN totals t
  )
  SELECT
    -- lowest-role's contribution to weekly high-value actions
    -- (target: at least 5% from the smallest active role)
    COALESCE((SELECT MIN(pct) FROM shares), 0) AS lowest_pct,
    -- evenness: 1.0 = perfectly even, 0.0 = single role
    -- proxy: 1 - (max-min) / (max+min) for active roles
    CASE
      WHEN (SELECT COUNT(*) FROM shares) <= 1 THEN 0
      ELSE 1.0 - (
        (SELECT MAX(pct) FROM shares) - (SELECT MIN(pct) FROM shares)
      ) / NULLIF((SELECT MAX(pct) FROM shares) + (SELECT MIN(pct) FROM shares), 0)
    END AS evenness
  INTO v_lowest_role_pct, v_role_evenness;

  -- Cross-role interaction rate: % of last-7d reciprocal conversations
  -- that span ≥2 roles. Already captured above.
  SELECT CASE
    WHEN v_recip_cross_role_7d + v_recip_same_role_7d = 0 THEN 0
    ELSE 100.0 * v_recip_cross_role_7d::NUMERIC
         / (v_recip_cross_role_7d + v_recip_same_role_7d)
  END INTO v_cross_role_pct;

  v_role_balance_score := COALESCE(
    -- Lowest-role contribution — target 5% (any role contributes 5%+)
    public._phs_normalize(v_lowest_role_pct, 5) * 0.50 +
    -- Cross-role interaction rate — target 30%
    public._phs_normalize(v_cross_role_pct, 30) * 0.30 +
    -- Role evenness — target 0.7
    public._phs_normalize(v_role_evenness * 100, 70) * 0.20,
    0
  );

  -- ============================================================================
  -- E. Activation loop (10%)
  -- Role-specific 7-day activation. Onboarding done is NOT activation.
  -- ============================================================================
  SELECT COUNT(*) INTO v_signups_30d
  FROM profiles
  WHERE is_test_account IS NOT TRUE
    AND created_at > v_window_30d
    AND onboarding_completed = true;

  -- Activated = onboarding_completed AND ≥1 high-value event in 7d after signup
  SELECT COUNT(DISTINCT p.id) INTO v_activated_in_7d
  FROM profiles p
  WHERE p.is_test_account IS NOT TRUE
    AND p.created_at > v_window_30d
    AND p.onboarding_completed = true
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.user_id = p.id
        AND e.event_name = ANY(v_high_value_events)
        AND e.created_at >= p.created_at
        AND e.created_at <  p.created_at + INTERVAL '7 days'
    );

  -- Target: 50% activation
  v_activation_score := COALESCE(
    public._phs_normalize(
      CASE WHEN v_signups_30d = 0 THEN 0
           ELSE 100.0 * v_activated_in_7d / v_signups_30d END,
      50
    ),
    0
  );

  -- ============================================================================
  -- F. Content/Liveness loop (5%)
  -- Engagement ratio, not posting volume. Posts that get reactions count.
  -- ============================================================================
  -- Posts per active user per week (last 7d)
  SELECT CASE
    WHEN v_active_users_7d = 0 THEN 0
    ELSE (
      SELECT COUNT(*)::NUMERIC
      FROM user_posts up
      JOIN profiles p ON p.id = up.author_id
      WHERE up.created_at > v_window_7d
        AND up.deleted_at IS NULL
        AND p.is_test_account IS NOT TRUE
    ) / v_active_users_7d
  END INTO v_posts_per_user;

  -- % of last-30d posts that received ≥1 comment
  WITH posts AS (
    SELECT up.id
    FROM user_posts up
    JOIN profiles p ON p.id = up.author_id
    WHERE up.created_at > v_window_30d
      AND up.deleted_at IS NULL
      AND p.is_test_account IS NOT TRUE
  )
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM posts) = 0 THEN 0
    ELSE 100.0 * (
      SELECT COUNT(DISTINCT post_id)
      FROM post_comments pc
      WHERE pc.post_id IN (SELECT id FROM posts)
        AND pc.deleted_at IS NULL
    ) / (SELECT COUNT(*) FROM posts)
  END INTO v_posts_with_comment;

  -- References given per active user per month
  SELECT CASE
    WHEN v_active_users_30d = 0 THEN 0
    ELSE v_refs_accepted_30d::NUMERIC / v_active_users_30d
  END INTO v_refs_given_per_user;

  v_content_score := COALESCE(
    public._phs_normalize(v_posts_per_user, 0.30) * 0.30 +
    public._phs_normalize(v_posts_with_comment, 30) * 0.40 +
    public._phs_normalize(v_refs_given_per_user, 0.20) * 0.30,
    0
  );

  -- ============================================================================
  -- Overall score (weighted)
  -- ============================================================================
  v_overall_score :=
    v_recruitment_score   * 0.30 +
    v_network_score       * 0.25 +
    v_retention_score     * 0.20 +
    v_role_balance_score  * 0.10 +
    v_activation_score    * 0.10 +
    v_content_score       * 0.05;

  v_overall_score := ROUND(v_overall_score, 1);

  -- ============================================================================
  -- Build the JSON payload
  -- ============================================================================
  v_payload := jsonb_build_object(
    'overall_score',  v_overall_score,
    'tier',           CASE
                         WHEN v_overall_score >= 80 THEN 'excellent'
                         WHEN v_overall_score >= 60 THEN 'working'
                         WHEN v_overall_score >= 40 THEN 'building'
                         WHEN v_overall_score >= 20 THEN 'weak'
                         ELSE 'critical'
                       END,
    'computed_at',    v_now_ts,
    'window',         '30d / 7d',

    'sub_scores', jsonb_build_object(
      'recruitment',   jsonb_build_object('score', ROUND(v_recruitment_score, 1),  'weight', 0.30),
      'network',       jsonb_build_object('score', ROUND(v_network_score, 1),      'weight', 0.25),
      'retention',     jsonb_build_object('score', ROUND(v_retention_score, 1),    'weight', 0.20),
      'role_balance',  jsonb_build_object('score', ROUND(v_role_balance_score, 1), 'weight', 0.10),
      'activation',    jsonb_build_object('score', ROUND(v_activation_score, 1),   'weight', 0.10),
      'content',       jsonb_build_object('score', ROUND(v_content_score, 1),      'weight', 0.05)
    ),

    'diagnostics', jsonb_build_object(
      'baseline', jsonb_build_object(
        'real_profiles',     v_total_real_profiles,
        'active_users_7d',   v_active_users_7d,
        'active_users_30d',  v_active_users_30d
      ),
      'recruitment', jsonb_build_object(
        'opportunities_30d',         v_opp_count_30d,
        'opportunities_with_view',   v_opp_with_view,
        'opportunities_with_apps',   v_opp_with_application,
        'applications_30d',          v_apps_total_30d,
        'applications_reviewed_30d', v_apps_reviewed_30d,
        'tiers_5_6_measured',        false
      ),
      'network', jsonb_build_object(
        'reciprocal_cross_role_7d',  v_recip_cross_role_7d,
        'reciprocal_same_role_7d',   v_recip_same_role_7d,
        'friendships_accepted_30d',  v_friendships_30d,
        'references_accepted_30d',   v_refs_accepted_30d,
        'friend_accept_rate_pct',    ROUND(v_friend_accept_rate, 1)
      ),
      'retention', jsonb_build_object(
        'meaningful_w1_pct',         ROUND(COALESCE(v_meaningful_w1, 0), 1),
        'meaningful_w4_pct',         ROUND(COALESCE(v_meaningful_w4, 0), 1),
        'dau_mau_stickiness',        ROUND(v_dau_mau_stickiness, 3),
        'hv_actions_per_user_7d',    ROUND(v_hv_actions_per_user, 2),
        'w1_cohort_known',           v_meaningful_w1 IS NOT NULL,
        'w4_cohort_known',           v_meaningful_w4 IS NOT NULL
      ),
      'role_balance', jsonb_build_object(
        'lowest_role_pct',           ROUND(v_lowest_role_pct, 1),
        'cross_role_interaction_pct',ROUND(v_cross_role_pct, 1),
        'evenness',                  ROUND(v_role_evenness, 3)
      ),
      'activation', jsonb_build_object(
        'signups_30d',               v_signups_30d,
        'activated_in_7d',           v_activated_in_7d,
        'activation_rate_pct',       CASE WHEN v_signups_30d = 0 THEN NULL
                                          ELSE ROUND(100.0 * v_activated_in_7d / v_signups_30d, 1) END
      ),
      'content', jsonb_build_object(
        'posts_per_active_user_7d',  ROUND(v_posts_per_user, 3),
        'posts_with_comment_pct',    ROUND(v_posts_with_comment, 1),
        'refs_given_per_user_30d',   ROUND(v_refs_given_per_user, 3),
        'low_data_confidence',       v_active_users_30d < 50  -- flag UI
      )
    ),

    -- Bottleneck: lowest sub-score weighted by importance
    'bottleneck', (
      SELECT jsonb_build_object('loop', loop, 'score', score, 'weight', weight)
      FROM (
        VALUES
          ('recruitment',  v_recruitment_score,  0.30),
          ('network',      v_network_score,      0.25),
          ('retention',    v_retention_score,    0.20),
          ('role_balance', v_role_balance_score, 0.10),
          ('activation',   v_activation_score,   0.10),
          ('content',      v_content_score,      0.05)
      ) AS t(loop, score, weight)
      ORDER BY (100 - score) * weight DESC
      LIMIT 1
    )
  );

  RETURN v_payload;
END;
$$;

COMMENT ON FUNCTION public.compute_product_health_score IS
  'Computes the HOCKIA Product Health Score (0–100) from the 6 core loop sub-scores. Strict by design: passive activity contributes near zero. See migration 20260427150000 for the full spec, weights, and metric targets.';

-- ============================================================================
-- admin_get_product_health_score: admin-gated wrapper
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_get_product_health_score()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN public.compute_product_health_score();
END;
$$;

COMMENT ON FUNCTION public.admin_get_product_health_score IS
  'Admin-only wrapper around compute_product_health_score. Used by the AdminOverview landing page.';

GRANT EXECUTE ON FUNCTION public.admin_get_product_health_score() TO authenticated;
