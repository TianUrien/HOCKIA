-- Repair migration: admin_get_opportunities (Phase 3A) crashed on every
-- call because p_gender was declared as text but opportunities.gender is
-- the opportunity_gender enum. Postgres raises:
--   "operator does not exist: opportunity_gender = text"
-- The fix is to also cast on the comparison side; we keep the parameter
-- as text so the JS RPC client doesn't need to know about the PG enum
-- type, and cast to opportunity_gender at the WHERE clause.
--
-- An equivalent fix would be to change the parameter type itself to
-- opportunity_gender, but that would require a DROP + CREATE (param
-- list change). The cast approach keeps the function signature stable
-- and is backwards-compatible with the existing API wrapper.
--
-- Live reproduction: GET /admin/opportunities on staging immediately
-- after Phase 3A landed → "Failed to get opportunities: operator does
-- not exist: opportunity_gender = text". Tian saw it on
-- staging.inhockia.com/admin/opportunities, screenshot in chat
-- 2026-05-25.

SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_get_opportunities(
  p_status opportunity_status DEFAULT NULL,
  p_club_id uuid DEFAULT NULL,
  p_days integer DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
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
      -- Cast text param to enum so the equality has matching types.
      -- The frontend's gender dropdown only ever emits valid enum
      -- values ('Women' | 'Men'), so the cast is safe.
      AND (p_gender IS NULL OR o.gender = p_gender::opportunity_gender)
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
    -- Cast enum to text so the returned column matches the declared
    -- TABLE shape (text). The frontend uses it as a string anyway.
    o.gender::text,
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
    AND (p_gender IS NULL OR o.gender = p_gender::opportunity_gender)
    AND (p_has_apps IS NULL
         OR (p_has_apps = true AND COALESCE(os.app_count, 0) > 0)
         OR (p_has_apps = false AND COALESCE(os.app_count, 0) = 0))
  ORDER BY o.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

NOTIFY pgrst, 'reload schema';
