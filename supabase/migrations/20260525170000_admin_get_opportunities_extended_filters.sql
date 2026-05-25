-- Extend admin_get_opportunities for Phase 3A of the admin audit:
-- four new filter params + return gender so the Opportunities list page
-- can triage by country / role / gender / has-applications instead of
-- just status / days.
--
-- Why server-side: the existing pagination already lives on the RPC, so
-- doing the new filters client-side would mean "filtered count" disagrees
-- with "total count" on every page. Better to push them down.
--
-- DROP + CREATE because:
--   1. The RETURNS TABLE shape gains a new `gender` column, which
--      CREATE OR REPLACE FUNCTION can't change.
--   2. The argument list gains four new optional params with defaults.
--      CREATE OR REPLACE could in principle handle defaults-only additions
--      but the TABLE-shape change forces a drop anyway.

SET search_path = public;

DROP FUNCTION IF EXISTS public.admin_get_opportunities(opportunity_status, uuid, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_get_opportunities(
  p_status opportunity_status DEFAULT NULL,
  p_club_id uuid DEFAULT NULL,
  p_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  -- Phase 3A — new filter params. All optional; NULL means "no filter".
  -- p_country uses ISO-2 country code (matches opportunities.location_country
  -- shape on prod, e.g. "AR", "AU", "GB").
  -- p_opportunity_type filters by 'player' | 'coach'.
  -- p_gender filters by 'Women' | 'Men' (case-sensitive — matches the
  -- enum-like values seen on prod opportunities.gender).
  -- p_has_apps: true → only opportunities with >=1 application; false →
  -- only zero-application opportunities; NULL → no filter.
  p_country text DEFAULT NULL,
  p_opportunity_type opportunity_type DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_has_apps boolean DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  club_id uuid,
  club_name text,
  club_avatar_url text,
  status opportunity_status,
  opportunity_type opportunity_type,
  "position" opportunity_position,
  -- Phase 3A: gender exposed so the table can show it AND so the new
  -- filter UI can build a gender dropdown from observed values.
  gender text,
  location_city text,
  location_country text,
  application_count bigint,
  pending_count bigint,
  shortlisted_count bigint,
  first_application_at timestamp with time zone,
  time_to_first_app_minutes integer,
  created_at timestamp with time zone,
  published_at timestamp with time zone,
  application_deadline date,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Count of opportunities passing ALL filters. Uses GROUP BY + HAVING
  -- so the has_apps filter (an aggregate condition) can be applied
  -- per-opportunity, then wraps in a CTE to collapse the grouped rows
  -- to a single scalar via outer COUNT(*). Same filter clause is
  -- repeated on the RETURN QUERY below — keeps total_count consistent
  -- with what the user pages through.
  WITH filtered AS (
    SELECT o.id
    FROM opportunities o
    LEFT JOIN opportunity_applications oa ON oa.opportunity_id = o.id
    WHERE
      (p_status IS NULL OR o.status = p_status)
      AND (p_club_id IS NULL OR o.club_id = p_club_id)
      AND (p_days IS NULL OR o.created_at > now() - (p_days || ' days')::INTERVAL)
      AND (p_country IS NULL OR o.location_country = p_country)
      AND (p_opportunity_type IS NULL OR o.opportunity_type = p_opportunity_type)
      AND (p_gender IS NULL OR o.gender = p_gender)
    GROUP BY o.id
    HAVING (p_has_apps IS NULL
            OR (p_has_apps = true AND COUNT(oa.id) > 0)
            OR (p_has_apps = false AND COUNT(oa.id) = 0))
  )
  SELECT COUNT(*) INTO v_total FROM filtered;

  RETURN QUERY
  WITH opportunity_stats AS (
    SELECT
      oa.opportunity_id,
      COUNT(oa.id) as app_count,
      COUNT(oa.id) FILTER (WHERE oa.status = 'pending') as pending_cnt,
      COUNT(oa.id) FILTER (WHERE oa.status = 'shortlisted') as shortlisted_cnt,
      MIN(oa.applied_at) as first_app
    FROM opportunity_applications oa
    GROUP BY oa.opportunity_id
  )
  SELECT
    o.id,
    o.title,
    o.club_id,
    p.full_name as club_name,
    p.avatar_url as club_avatar_url,
    o.status,
    o.opportunity_type,
    o."position",
    o.gender,
    o.location_city,
    o.location_country,
    COALESCE(os.app_count, 0)::BIGINT,
    COALESCE(os.pending_cnt, 0)::BIGINT,
    COALESCE(os.shortlisted_cnt, 0)::BIGINT,
    os.first_app,
    CASE
      WHEN os.first_app IS NOT NULL AND o.published_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (os.first_app - o.published_at))::INTEGER / 60
      ELSE NULL
    END,
    o.created_at,
    o.published_at,
    o.application_deadline,
    v_total
  FROM opportunities o
  JOIN profiles p ON p.id = o.club_id
  LEFT JOIN opportunity_stats os ON os.opportunity_id = o.id
  WHERE
    (p_status IS NULL OR o.status = p_status)
    AND (p_club_id IS NULL OR o.club_id = p_club_id)
    AND (p_days IS NULL OR o.created_at > now() - (p_days || ' days')::INTERVAL)
    AND (p_country IS NULL OR o.location_country = p_country)
    AND (p_opportunity_type IS NULL OR o.opportunity_type = p_opportunity_type)
    AND (p_gender IS NULL OR o.gender = p_gender)
    AND (p_has_apps IS NULL
         OR (p_has_apps = true AND COALESCE(os.app_count, 0) > 0)
         OR (p_has_apps = false AND COALESCE(os.app_count, 0) = 0))
  ORDER BY o.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_opportunities(
  opportunity_status, uuid, integer, integer, integer,
  text, opportunity_type, text, boolean
) TO authenticated;

-- Phase 3A: small RPC to power the "Zero-Activity Users" tile on
-- Overview. Returns the count of users who signed up >=p_days_threshold
-- days ago AND have done zero value-actions (apply, message, post,
-- friend request, profile edit since signup). One row, two ints.
--
-- "value action" = anything that suggests the user got past the
-- onboarding wall into actual engagement. Conservative whitelist —
-- viewing things doesn't count, doing things does.
CREATE OR REPLACE FUNCTION public.admin_get_zero_activity_users(
  p_days_threshold integer DEFAULT 7
)
RETURNS TABLE (
  total_signups bigint,
  zero_activity_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  WITH cohort AS (
    SELECT id
    FROM profiles
    WHERE NOT is_test_account
      AND created_at <= now() - (p_days_threshold || ' days')::INTERVAL
  ),
  active AS (
    SELECT DISTINCT user_id AS id
    FROM events
    WHERE event_name IN (
      'application_submit',
      'message_send',
      'friend_request_send',
      'post_create',
      'reference_request_send',
      'profile_update'
    )
      AND user_id IN (SELECT id FROM cohort)
  )
  SELECT
    (SELECT COUNT(*) FROM cohort)::BIGINT,
    (SELECT COUNT(*) FROM cohort WHERE id NOT IN (SELECT id FROM active))::BIGINT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_zero_activity_users(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
