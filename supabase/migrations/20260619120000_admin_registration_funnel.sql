-- ============================================================================
-- admin_get_registration_funnel — the web/PWA acquisition funnel (registered half)
-- ============================================================================
-- Source of truth = Supabase only (profiles + the first-party `events` table),
-- so the numbers are EXACT and bot-free (test accounts excluded, no GA / consent
-- dependency). The anonymous top-of-funnel (landing → CTA → wall → signup-started)
-- lives only in GA4 and is layered on in a later phase; this RPC owns the part we
-- can count precisely: what happens from account creation onward.
--
-- Steps (Tian's funnel, mapped to the data that actually exists):
--   account_created      every real account in the cohort (profiles.created_at)
--   role_selected        role IS NOT NULL — in practice ~100% (role is captured
--                        at signup via pending_role, so this is NOT a drop-off
--                        point; it's a finding: role selection never leaks)
--   onboarding_started   fired any `onboarding_step` event (the wizard) — derived
--                        from `events`, because profiles.onboarding_started_at is
--                        defined but NEVER written (0 rows in prod)
--   onboarding_completed profiles.onboarding_completed = true — the reliable
--                        completion signal (218 in prod; beats the _at timestamp
--                        of 144 and the onboarding_completed event of 83)
--   activated            fired a real post-onboarding engagement event (viewed a
--                        profile/vacancy, applied, messaged, posted, …) — a far
--                        more meaningful "first meaningful action" than
--                        profile_completeness_pct ≥ 80 (only 11 in prod)
--
-- CUMULATIVE-UNION semantics (same fix as 20260525140000): each step counts
-- users who reached it OR any LATER step, so the chain is monotonically
-- non-increasing and drop-off math is always in [0, 100%]. Real product order
-- can vary (a user might browse before finishing onboarding); the "reached this
-- or beyond" definition keeps the funnel coherent regardless.
--
-- Filters: p_days (NULL = all time), p_role. Breakdowns returned: by_role
-- (answers "which role completes onboarding better") and by_country (answers
-- "where do they convert" — note base_country_id is only ~25% populated, so an
-- "Unknown" bucket dominates; surfaced honestly).

SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_get_registration_funnel(
  p_days INTEGER DEFAULT NULL,
  p_role TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
  v_since TIMESTAMPTZ;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  v_since := CASE
    WHEN p_days IS NULL THEN '-infinity'::TIMESTAMPTZ
    ELSE now() - (p_days || ' days')::INTERVAL
  END;

  WITH cohort AS (
    SELECT id, role, COALESCE(onboarding_completed, false) AS onboarding_completed, base_country_id
    FROM profiles
    WHERE COALESCE(is_test_account, false) = false
      AND created_at >= v_since
      AND (p_role IS NULL OR role = p_role)
  ),
  -- One row per user with the raw step signals.
  raw AS (
    SELECT
      c.id,
      COALESCE(c.role, 'unknown') AS role,
      c.base_country_id,
      c.onboarding_completed AS oc_raw,
      (c.role IS NOT NULL) AS rs_raw,
      EXISTS (
        SELECT 1 FROM events e
        WHERE e.user_id = c.id AND e.event_name = 'onboarding_step'
      ) AS os_raw,
      EXISTS (
        SELECT 1 FROM events e
        WHERE e.user_id = c.id
          AND e.event_name IN (
            'profile_view', 'vacancy_view', 'application_submit', 'message_send',
            'conversation_start', 'friend_request_send', 'opportunity_create',
            'post_create', 'post_like'
          )
      ) AS a_raw
    FROM cohort c
  ),
  -- Cumulative-union: each flag is "this signal OR any downstream signal".
  cum AS (
    SELECT
      id, role, base_country_id,
      a_raw                                            AS activated,
      (oc_raw OR a_raw)                                AS onboarding_completed,
      (os_raw OR oc_raw OR a_raw)                      AS onboarding_started,
      (rs_raw OR os_raw OR oc_raw OR a_raw)            AS role_selected
    FROM raw
  )
  SELECT json_build_object(
    'window_days', p_days,
    'role', p_role,
    'funnel', json_build_object(
      'account_created',      COUNT(*),
      'role_selected',        COUNT(*) FILTER (WHERE role_selected),
      'onboarding_started',   COUNT(*) FILTER (WHERE onboarding_started),
      'onboarding_completed', COUNT(*) FILTER (WHERE onboarding_completed),
      'activated',            COUNT(*) FILTER (WHERE activated)
    ),
    'by_role', (
      SELECT COALESCE(json_object_agg(role, counts), '{}'::json)
      FROM (
        SELECT role, json_build_object(
          'account_created',      COUNT(*),
          'onboarding_completed', COUNT(*) FILTER (WHERE onboarding_completed),
          'completion_rate', CASE WHEN COUNT(*) > 0
            THEN ROUND(COUNT(*) FILTER (WHERE onboarding_completed) * 100.0 / COUNT(*), 1)
            ELSE 0 END
        ) AS counts
        FROM cum
        GROUP BY role
      ) r
    ),
    'by_country', (
      SELECT COALESCE(json_agg(row_to_json(bc)), '[]'::json)
      FROM (
        SELECT
          COALESCE(co.name, 'Unknown') AS country,
          COUNT(*) AS account_created,
          COUNT(*) FILTER (WHERE cum.onboarding_completed) AS onboarding_completed
        FROM cum
        LEFT JOIN countries co ON co.id = cum.base_country_id
        GROUP BY COALESCE(co.name, 'Unknown')
        ORDER BY COUNT(*) DESC
        LIMIT 8
      ) bc
    )
  ) INTO v_result
  FROM cum;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_registration_funnel(INTEGER, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
