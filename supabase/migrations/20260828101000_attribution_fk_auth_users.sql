-- Attribution v2 follow-up: attribution belongs to the ACCOUNT, not the profile.
--
-- Found on staging end-to-end (2026-08-28): record_signup_attribution() at
-- registration failed with 23503 — signup_attribution.user_id referenced
-- profiles(id), and a profile row only exists once onboarding starts. That
-- is exactly the population the registration-time write was meant to
-- capture (members who register and stall before onboarding: 3 of 36
-- recent signups had no row for this reason).
--
-- Re-point the FK to auth.users (cascade on account deletion — the
-- delete-account edge function removes the auth user, which now removes the
-- attribution row too), and let the acquisition report count members with
-- no profile yet.

ALTER TABLE public.signup_attribution
  DROP CONSTRAINT IF EXISTS signup_attribution_user_id_fkey;
ALTER TABLE public.signup_attribution
  ADD CONSTRAINT signup_attribution_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.admin_get_acquisition_report(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := now() - make_interval(days => p_days);
  v_prev_from timestamptz := now() - make_interval(days => p_days * 2);
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  WITH base AS (
    -- LEFT JOIN: a member who registered but never started onboarding has
    -- attribution and no profile — they count as a signup, not activated.
    SELECT sa.*,
           COALESCE(p.created_at, sa.signup_at) AS joined_at,
           COALESCE(p.onboarding_completed, false) AS onboarding_completed
    FROM signup_attribution sa
    LEFT JOIN profiles p ON p.id = sa.user_id
    WHERE COALESCE(p.is_test_account, false) = false
  ),
  cur AS (SELECT * FROM base WHERE joined_at >= v_from),
  prev AS (SELECT * FROM base WHERE joined_at >= v_prev_from AND joined_at < v_from),
  prev_agg AS (
    SELECT COALESCE(first_touch_source, 'unknown') AS source, COUNT(*)::int AS prev_signups
    FROM prev GROUP BY 1
  ),
  by_channel AS (
    SELECT
      COALESCE(c.first_touch_source, 'unknown') AS source,
      MAX(COALESCE(c.first_touch_group, 'unknown')) AS channel_group,
      COUNT(*)::int AS signups,
      COUNT(*) FILTER (WHERE c.onboarding_completed)::int AS activated,
      COALESCE(MAX(pa.prev_signups), 0) AS prev_signups
    FROM cur c
    LEFT JOIN prev_agg pa ON pa.source = COALESCE(c.first_touch_source, 'unknown')
    GROUP BY COALESCE(c.first_touch_source, 'unknown')
  )
  SELECT jsonb_build_object(
    'period_days', p_days,
    'generated_at', now(),
    'total_signups', (SELECT COUNT(*) FROM cur),
    'channels', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'source', source, 'group', channel_group, 'signups', signups,
        'activated', activated, 'prev_signups', prev_signups
      ) ORDER BY signups DESC) FROM by_channel), '[]'::jsonb),
    'methods', COALESCE((SELECT jsonb_object_agg(m, n) FROM (
        SELECT COALESCE(attribution_method, 'unknown') m, COUNT(*)::int n FROM cur GROUP BY 1) x), '{}'::jsonb),
    'confidence', COALESCE((SELECT jsonb_object_agg(m, n) FROM (
        SELECT COALESCE(attribution_confidence, 'unknown') m, COUNT(*)::int n FROM cur GROUP BY 1) x), '{}'::jsonb),
    'platforms', COALESCE((SELECT jsonb_object_agg(m, n) FROM (
        SELECT COALESCE(platform, 'unknown') m, COUNT(*)::int n FROM cur GROUP BY 1) x), '{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
