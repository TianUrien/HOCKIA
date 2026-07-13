-- Home V2 Phase 2 (club Pulse) — get_my_roles_health(): per-role health for
-- the caller's OPEN opportunities, one round trip for the "Your open roles" +
-- "Applicants to review" modules.
--
-- Per role: views_7d / views_prior_7d (from vacancy_view events — no
-- owner-scoped aggregate existed; only admin/global ones), applicant_count,
-- pending_count, and new_count = pending applications the club has never
-- opened (no application_views row by this viewer — the same signal
-- ApplicantCard writes via record_application_view).
--
-- FENCES (SECURITY DEFINER bypasses RLS → self-carried, standing invariant):
--  • view counts exclude hidden viewers (banned/frozen), test-account viewers,
--    and self-views — mirroring get_my_weekly_visibility so the two "views"
--    numbers a club sees on one screen can never disagree in kind;
--  • applicant counts exclude hidden applicants (count/list parity with
--    fenced applicant surfaces). Test applicants are NOT fenced — matching
--    fetch_club_opportunities_with_counts, the module's sibling source.
-- Caller sees only their own roles (o.club_id = auth.uid()).
CREATE OR REPLACE FUNCTION public.get_my_roles_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
    SELECT
      COUNT(*) FILTER (WHERE e.created_at >= now() - interval '7 days') AS views_7d,
      COUNT(*) FILTER (WHERE e.created_at <  now() - interval '7 days') AS views_prior_7d
    FROM public.events e
    LEFT JOIN public.profiles vp ON vp.id = e.user_id
    WHERE e.event_name = 'vacancy_view'
      AND e.entity_type = 'vacancy'
      AND e.entity_id = o.id
      AND e.created_at >= now() - interval '14 days'
      AND (e.user_id IS DISTINCT FROM v_uid)
      AND (vp.id IS NULL OR (
            COALESCE(vp.is_test_account, false) = false
            AND NOT public.profile_is_hidden(vp.is_blocked, vp.frozen_minor_at)))
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

REVOKE EXECUTE ON FUNCTION public.get_my_roles_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_roles_health() TO authenticated;
