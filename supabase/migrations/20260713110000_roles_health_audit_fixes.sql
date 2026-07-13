-- Phase-2 pre-ship audit fixes for the club Pulse metrics (findings F2 + F3).
--
-- F2 — get_my_roles_health counted NULL-user vacancy_view rows. Two problems:
--  (a) parity: get_my_weekly_visibility (the OTHER views number on the same
--      hero) excludes anonymous views, so the two disagreed in kind;
--  (b) integrity: events' INSERT policy accepts user_id NULL from any
--      authenticated caller (and track_event kept PUBLIC EXECUTE), so
--      NULL-user rows are trivially forgeable — they bypassed the self/test/
--      hidden viewer fences and could inflate any club's per-role views.
--  Fix: count only identified viewers (INNER JOIN profiles), exactly like
--  get_my_weekly_visibility. Also adds STABLE (matches the Phase-0 siblings).
--
-- F3 — cross-surface parity: get_my_roles_health fences HIDDEN applicants out
--  of its counts (standing invariant) but the sibling
--  fetch_club_opportunities_with_counts did NOT — the same role would show
--  "5 applicants" on the opportunities screen and "4" on Pulse. The sibling
--  was the invariant violator; it gains the same fence.

CREATE OR REPLACE FUNCTION public.get_my_roles_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_items jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'opportunity_id', o.id,
    'title', o.title,
    'position', o."position",
    'created_at', o.created_at,
    'views_7d', COALESCE(v.views_7d, 0),
    'views_prior_7d', COALESCE(v.views_prior_7d, 0),
    'applicant_count', COALESCE(a.total, 0),
    'pending_count', COALESCE(a.pending, 0),
    'new_count', COALESCE(a.new_unviewed, 0)
  ) ORDER BY o.created_at DESC), '[]'::jsonb)
  INTO v_items
  FROM public.opportunities o
  LEFT JOIN LATERAL (
    -- Identified viewers only (INNER JOIN): anonymous rows are forgeable and
    -- unfenceable; parity with get_my_weekly_visibility.
    SELECT
      COUNT(*) FILTER (WHERE e.created_at >= now() - interval '7 days') AS views_7d,
      COUNT(*) FILTER (WHERE e.created_at <  now() - interval '7 days') AS views_prior_7d
    FROM public.events e
    JOIN public.profiles vp ON vp.id = e.user_id
    WHERE e.event_name = 'vacancy_view'
      AND e.entity_type = 'vacancy'
      AND e.entity_id = o.id
      AND e.created_at >= now() - interval '14 days'
      AND e.user_id <> v_uid
      AND COALESCE(vp.is_test_account, false) = false
      AND NOT public.profile_is_hidden(vp.is_blocked, vp.frozen_minor_at)
  ) v ON true
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE ap.status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE ap.status = 'pending' AND av.id IS NULL) AS new_unviewed
    FROM public.opportunity_applications ap
    JOIN public.profiles app_p ON app_p.id = ap.applicant_id
    LEFT JOIN public.application_views av
      ON av.application_id = ap.id AND av.viewer_id = v_uid
    WHERE ap.opportunity_id = o.id
      AND NOT public.profile_is_hidden(app_p.is_blocked, app_p.frozen_minor_at)
  ) a ON true
  WHERE o.club_id = v_uid
    AND o.status = 'open';

  RETURN v_items;
END;
$$;

-- F3: hidden-applicant fence on the sibling counts RPC (SECURITY INVOKER —
-- the fence subquery reads profiles under the caller's RLS, where hidden
-- profiles are already invisible; an EXISTS on an invisible row is FALSE, so
-- express the fence as "applicant profile VISIBLE and not hidden" — i.e. an
-- INNER JOIN to profiles, which under RLS excludes hidden applicants for
-- regular callers and keeps the same rows for service_role/admin readers of
-- the underlying data.
CREATE OR REPLACE FUNCTION public.fetch_club_opportunities_with_counts(
  p_club_id uuid,
  p_include_closed boolean DEFAULT true,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid, club_id uuid, title text, opportunity_type opportunity_type,
  "position" opportunity_position, gender opportunity_gender, description text,
  location_city text, location_country text, start_date date, duration_text text,
  requirements text[], specialist_skills_wanted text[],
  level_sought text, compensation text, recruitment_problem text,
  eu_passport_required boolean,
  position_required boolean, level_required boolean, compensation_required boolean,
  location_required boolean, availability_required boolean, specialists_required boolean,
  benefits text[], custom_benefits text[],
  priority opportunity_priority, status opportunity_status, application_deadline date,
  contact_email text, contact_phone text, organization_name text,
  published_at timestamp with time zone, closed_at timestamp with time zone,
  version integer, created_at timestamp with time zone, updated_at timestamp with time zone,
  applicant_count bigint, pending_count bigint
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  effective_limit INTEGER := LEAST(COALESCE(p_limit, 50), 200);
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.club_id,
    o.title,
    o.opportunity_type,
    o."position",
    o.gender,
    o.description,
    o.location_city,
    o.location_country,
    o.start_date,
    o.duration_text,
    o.requirements,
    o.specialist_skills_wanted,
    o.level_sought,
    o.compensation,
    o.recruitment_problem,
    o.eu_passport_required,
    o.position_required,
    o.level_required,
    o.compensation_required,
    o.location_required,
    o.availability_required,
    o.specialists_required,
    o.benefits,
    o.custom_benefits,
    o.priority,
    o.status,
    o.application_deadline,
    o.contact_email,
    o.contact_phone,
    o.organization_name,
    o.published_at,
    o.closed_at,
    o.version,
    o.created_at,
    o.updated_at,
    COALESCE(counts.total, 0) AS applicant_count,
    COALESCE(counts.pending, 0) AS pending_count
  FROM public.opportunities o
  LEFT JOIN (
    SELECT
      oa.opportunity_id,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE oa.status = 'pending') AS pending
    FROM public.opportunity_applications oa
    JOIN public.profiles ap ON ap.id = oa.applicant_id
    WHERE NOT public.profile_is_hidden(ap.is_blocked, ap.frozen_minor_at)
    GROUP BY oa.opportunity_id
  ) counts ON counts.opportunity_id = o.id
  WHERE o.club_id = p_club_id
    AND (p_include_closed OR o.status <> 'closed')
  ORDER BY o.created_at DESC
  LIMIT effective_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fetch_club_opportunities_with_counts(uuid, boolean, integer) TO authenticated;
