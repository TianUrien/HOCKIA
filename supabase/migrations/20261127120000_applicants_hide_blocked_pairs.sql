-- Blocked applicants leave the club's view (founder decision 2026-11-27:
-- "hide them in both", the assistant connector and the app).
--
-- Until now a club still saw, by name, an applicant it had blocked or who had
-- blocked it: the publisher SELECT policy on opportunity_applications fenced
-- only hidden profiles. The connector got the same fence in
-- 20261127100000_mcp_connector_minors_and_blocks.sql.
--
--   1. Publisher SELECT policy: adds NOT is_blocked_pair(club, applicant).
--      Everything else is as in 20261002200000. fetch_club_opportunities_with_counts
--      is SECURITY INVOKER and counts through this policy, so its counts follow.
--   2. get_my_roles_health (SECURITY DEFINER, bypasses RLS): the same fence on
--      its applicant counts, so the list and every count agree.
--
-- Client compatibility: installed builds read the table and the RPC as before;
-- a blocked pair simply returns fewer rows. No shape, grant or column change.
-- Rollback: supabase/rollbacks/20261127120000_applicants_hide_blocked_pairs.down.sql
-- Probe: supabase/tests/security/applicants_hide_blocked_pairs.probe.sql

-- 1. Publisher read policy
DROP POLICY IF EXISTS "Publishers can view applications to their opportunities" ON public.opportunity_applications;
CREATE POLICY "Publishers can view applications to their opportunities" ON public.opportunity_applications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.opportunities o
      WHERE o.id = opportunity_applications.opportunity_id
        AND o.club_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles ap
      WHERE ap.id = opportunity_applications.applicant_id
        AND NOT public.profile_is_hidden(ap.is_blocked, ap.frozen_minor_at)
    )
    -- Block pair, either side: the club no longer sees this applicant.
    AND NOT public.is_blocked_pair((SELECT auth.uid()), opportunity_applications.applicant_id)
  );

-- 2. Club roles health counts
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
      AND NOT public.is_blocked_pair(v_uid, app_p.id)
  ) a ON true
  WHERE o.club_id = v_uid
    AND o.status = 'open';

  RETURN v_items;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_roles_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_roles_health() TO authenticated;
