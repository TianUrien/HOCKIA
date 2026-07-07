-- P6 — pre-campaign instrumentation (Master Order v2): the three questions
-- the campaign needs answered from day zero.
--   1. Which channel brings users who retain? → acquisition_source captured
--      at signup (first-touch UTM/referrer, persisted at onboarding).
--   2. Do campaign users stay? → week-2 cohort return per signup week
--      (computed from our own events table — verified 25/25 coverage of
--      recently-active profiles; no GA4 dependency).
--   3. How fast do clubs respond? → global median time-to-first-response
--      (same clean-by-construction rules as the responsiveness badge).

-- ────────────────────────────────────────────────────────────────────
-- 1. Acquisition columns (profiles uses COLUMN-LEVEL grants — the
--    standing CLAUDE.md rule: every new column ships with its GRANTs)
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS acquisition_source text,
  ADD COLUMN IF NOT EXISTS acquisition_meta jsonb;

GRANT SELECT (acquisition_source, acquisition_meta) ON public.profiles TO authenticated;
-- Written once by the owner during onboarding (client only writes when the
-- column is still NULL — first-touch wins).
GRANT UPDATE (acquisition_source, acquisition_meta) ON public.profiles TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 2. Week-2 cohort return, by signup week × acquisition source.
--    Returner = any events row in days 7–13 after signup (the second week).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_signup_cohort_retention(p_weeks integer DEFAULT 12)
RETURNS TABLE (
  cohort_week date,
  acquisition_source text,
  signups integer,
  week2_returners integer,
  week2_pct numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  WITH cohort AS (
    SELECT p.id,
           date_trunc('week', p.created_at)::date AS wk,
           COALESCE(NULLIF(p.acquisition_source, ''), 'unknown') AS src,
           p.created_at
    FROM profiles p
    WHERE COALESCE(p.is_test_account, false) = false
      AND p.created_at >= date_trunc('week', timezone('utc', now()))
                          - make_interval(weeks => GREATEST(1, LEAST(p_weeks, 52)))
  )
  SELECT c.wk,
         c.src,
         count(*)::int,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM events e
           WHERE e.user_id = c.id
             AND e.created_at >= c.created_at + interval '7 days'
             AND e.created_at <  c.created_at + interval '14 days'
         ))::int,
         round(100.0 * count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM events e
           WHERE e.user_id = c.id
             AND e.created_at >= c.created_at + interval '7 days'
             AND e.created_at <  c.created_at + interval '14 days'
         )) / count(*), 1)
  FROM cohort c
  GROUP BY c.wk, c.src
  ORDER BY c.wk DESC, c.src;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_get_signup_cohort_retention(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_signup_cohort_retention(integer) TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 3. Global median time-to-first-response (the P1 value metric).
--    Same clean-by-construction rules as the badge: first transition out
--    of pending, withdrawals excluded, post-launch applications only.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_response_time_stats()
RETURNS TABLE (
  median_hours numeric,
  responses_measured integer,
  publishers_with_badge integer,
  tier_fast integer,
  tier_week integer,
  tier_two_weeks integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_launch timestamptz;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT s.launch_date INTO v_launch FROM application_response_settings s;

  RETURN QUERY
  WITH first_response AS (
    SELECT DISTINCT ON (h.application_id)
      EXTRACT(EPOCH FROM (h.created_at - a.applied_at)) / 3600.0 AS hours
    FROM application_status_history h
    JOIN opportunity_applications a ON a.id = h.application_id
    WHERE h.old_status = 'pending'
      AND h.new_status <> 'withdrawn'
      AND v_launch IS NOT NULL
      AND a.applied_at >= v_launch
    ORDER BY h.application_id, h.created_at ASC
  )
  SELECT
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY fr.hours)::numeric, 1),
    count(*)::int,
    (SELECT count(*)::int FROM publisher_responsiveness pr WHERE pr.tier IS NOT NULL),
    (SELECT count(*)::int FROM publisher_responsiveness pr WHERE pr.tier = 'fast'),
    (SELECT count(*)::int FROM publisher_responsiveness pr WHERE pr.tier = 'week'),
    (SELECT count(*)::int FROM publisher_responsiveness pr WHERE pr.tier = 'two_weeks')
  FROM first_response fr;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_get_response_time_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_response_time_stats() TO authenticated;
