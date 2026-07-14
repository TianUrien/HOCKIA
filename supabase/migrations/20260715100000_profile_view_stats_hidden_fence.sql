-- M5 — get_my_profile_view_stats: apply the hidden-profile + block-pair fence
-- so the dashboard's "who viewed you" COUNTS match the already-fenced
-- get_my_profile_viewers LIST.
--
-- Before this, a banned/frozen (public.profile_is_hidden) or block-paired
-- viewer still incremented total_views / unique_viewers, while the viewers
-- LIST (20260707160000_age_gate_rpc_predicates) excludes exactly those rows.
-- That is a "never a list/count mismatch" invariant violation (CLAUDE.md) and
-- can de-anonymise a hidden viewer when a role bucket of 1 shows in the count
-- but nobody appears in the list.
--
-- Scope note: anonymity semantics are deliberately UNCHANGED. browse_anonymously
-- viewers are still counted in total_views/unique_viewers and reported
-- separately via anonymous_viewers; only the LIST hides them. This fix touches
-- ONLY the hidden/blocked dimension, mirroring the two predicates that
-- get_my_profile_viewers already applies (profile_is_hidden + the user_blocks
-- bidirectional EXISTS).

CREATE OR REPLACE FUNCTION public.get_my_profile_view_stats(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND COALESCE(p.is_test_account, false) = false
    -- Hidden-profile fence (parity with get_my_profile_viewers)
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = e.user_id)
         OR (ub.blocker_id = e.user_id AND ub.blocked_id = v_user_id)
    );

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
    AND COALESCE(p.is_test_account, false) = false
    -- Hidden-profile fence (parity with get_my_profile_viewers)
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = e.user_id)
         OR (ub.blocker_id = e.user_id AND ub.blocked_id = v_user_id)
    );

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
    AND COALESCE(p.is_test_account, false) = false
    -- Hidden-profile fence (parity with get_my_profile_viewers)
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = e.user_id)
         OR (ub.blocker_id = e.user_id AND ub.blocked_id = v_user_id)
    );

  RETURN jsonb_build_object(
    'success', true,
    'total_views', v_total_views,
    'unique_viewers', v_unique_viewers,
    'previous_total_views', v_previous_total,
    'previous_unique_viewers', v_previous_unique,
    'anonymous_viewers', v_anonymous_viewers
  );
END;
$function$;
