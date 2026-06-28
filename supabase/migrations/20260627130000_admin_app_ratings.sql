-- Admin App Ratings dashboard — Slice 2. STAGING FIRST.
-- Two SECURITY DEFINER RPCs (is_platform_admin gated) mirroring the feedback/
-- ai-opinion admin pattern: one aggregate metrics payload + one paginated list.

-- ── Metrics (windowed by p_days) + eligible-not-prompted snapshot ────────────
CREATE OR REPLACE FUNCTION public.admin_get_app_ratings_metrics(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since      timestamptz := timezone('utc', now()) - (p_days || ' days')::interval;
  v_shown      int; v_users_shown int; v_dismissed int; v_submitted int;
  v_summary    jsonb; v_dist jsonb; v_daily jsonb;
  v_by_role    jsonb; v_by_platform jsonb; v_by_version jsonb; v_by_country jsonb;
  v_eligible   int;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  -- Prompt funnel (windowed) from the events table.
  SELECT COUNT(*) FILTER (WHERE event_name = 'app_rating_prompt_shown'),
         COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'app_rating_prompt_shown'),
         COUNT(*) FILTER (WHERE event_name = 'app_rating_prompt_dismissed')
    INTO v_shown, v_users_shown, v_dismissed
  FROM public.events
  WHERE created_at >= v_since AND event_name LIKE 'app_rating_prompt_%';

  SELECT COUNT(*) INTO v_submitted FROM public.app_ratings WHERE submitted_at >= v_since;

  v_summary := jsonb_build_object(
    'avg_rating', (SELECT round(avg(rating_value)::numeric, 2) FROM public.app_ratings WHERE submitted_at >= v_since),
    'total_ratings', v_submitted,
    'prompts_shown', v_shown,
    'unique_users_shown', v_users_shown,
    'prompts_dismissed', v_dismissed,
    'conversion_rate', CASE WHEN v_users_shown > 0 THEN round((v_submitted::numeric / v_users_shown) * 100, 1) ELSE 0 END,
    'dismissal_rate',  CASE WHEN v_shown > 0 THEN round((v_dismissed::numeric / v_shown) * 100, 1) ELSE 0 END
  );

  -- 1-5 distribution (windowed).
  SELECT jsonb_agg(jsonb_build_object('rating', g.r,
           'count', (SELECT COUNT(*) FROM public.app_ratings a WHERE a.rating_value = g.r AND a.submitted_at >= v_since)
         ) ORDER BY g.r)
    INTO v_dist FROM generate_series(1, 5) g(r);

  -- Daily trend.
  SELECT jsonb_agg(jsonb_build_object('day', d,
           'submitted', (SELECT COUNT(*) FROM public.app_ratings a WHERE a.submitted_at::date = d),
           'shown',     (SELECT COUNT(*) FROM public.events e WHERE e.event_name = 'app_rating_prompt_shown' AND e.created_at::date = d),
           'dismissed', (SELECT COUNT(*) FROM public.events e WHERE e.event_name = 'app_rating_prompt_dismissed' AND e.created_at::date = d)
         ) ORDER BY d)
    INTO v_daily
  FROM generate_series(v_since::date, (timezone('utc', now()))::date, '1 day') d;

  -- Breakdowns (windowed).
  SELECT jsonb_agg(jsonb_build_object('user_role', user_role, 'count', c, 'avg', a) ORDER BY c DESC) INTO v_by_role
  FROM (SELECT COALESCE(user_role, 'unknown') AS user_role, COUNT(*) c, round(avg(rating_value)::numeric, 2) a
        FROM public.app_ratings WHERE submitted_at >= v_since GROUP BY 1) x;

  SELECT jsonb_agg(jsonb_build_object('platform', platform, 'count', c, 'avg', a) ORDER BY c DESC) INTO v_by_platform
  FROM (SELECT COALESCE(platform, 'unknown') AS platform, COUNT(*) c, round(avg(rating_value)::numeric, 2) a
        FROM public.app_ratings WHERE submitted_at >= v_since GROUP BY 1) x;

  SELECT jsonb_agg(jsonb_build_object('app_version', app_version, 'count', c, 'avg', a) ORDER BY c DESC) INTO v_by_version
  FROM (SELECT COALESCE(app_version, 'unknown') AS app_version, COUNT(*) c, round(avg(rating_value)::numeric, 2) a
        FROM public.app_ratings WHERE submitted_at >= v_since GROUP BY 1) x;

  SELECT jsonb_agg(jsonb_build_object('country', country, 'count', c, 'avg', a) ORDER BY c DESC) INTO v_by_country
  FROM (SELECT COALESCE(co.name, 'Unknown') AS country, COUNT(*) c, round(avg(r.rating_value)::numeric, 2) a
        FROM public.app_ratings r LEFT JOIN public.countries co ON co.id = r.country_id
        WHERE r.submitted_at >= v_since GROUP BY 1 ORDER BY c DESC LIMIT 10) x;

  -- Eligible-but-not-prompted (current snapshot): onboarded + >=7 active days, never shown, not rated.
  WITH eligible AS (
    SELECT user_id FROM public.user_engagement_daily GROUP BY user_id HAVING COUNT(DISTINCT date) >= 7
  )
  SELECT COUNT(*) INTO v_eligible
  FROM eligible e
  JOIN public.profiles p ON p.id = e.user_id AND p.onboarding_completed = true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.app_rating_prompt_state s
    WHERE s.user_id = e.user_id AND (s.shown_count > 0 OR s.rated)
  );

  RETURN jsonb_build_object(
    'summary', v_summary,
    'distribution', COALESCE(v_dist, '[]'::jsonb),
    'daily', COALESCE(v_daily, '[]'::jsonb),
    'by_role', COALESCE(v_by_role, '[]'::jsonb),
    'by_platform', COALESCE(v_by_platform, '[]'::jsonb),
    'by_version', COALESCE(v_by_version, '[]'::jsonb),
    'by_country', COALESCE(v_by_country, '[]'::jsonb),
    'eligible_not_prompted', v_eligible,
    'window_days', p_days,
    'generated_at', timezone('utc', now())
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_app_ratings_metrics(int) TO authenticated;

-- ── Paginated ratings list ───────────────────────────────────────────────────
-- p_stars = exact star value filter (null = all) so admins can triage e.g. all 1-star.
DROP FUNCTION IF EXISTS public.admin_get_app_ratings_list(int, int, int, text, text);
CREATE OR REPLACE FUNCTION public.admin_get_app_ratings_list(
  p_limit int DEFAULT 25, p_offset int DEFAULT 0,
  p_stars int DEFAULT NULL, p_platform text DEFAULT NULL, p_role text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_total int; v_rows jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT COUNT(*) INTO v_total FROM public.app_ratings r
  WHERE (p_stars IS NULL OR r.rating_value = p_stars)
    AND (p_platform IS NULL OR r.platform = p_platform)
    AND (p_role IS NULL OR r.user_role = p_role);

  SELECT jsonb_agg(row_to_json(sub)::jsonb) INTO v_rows FROM (
    SELECT r.id, r.rating_value, r.feedback_text, r.user_role, r.platform, r.app_version,
           r.build_number, r.environment, r.prompt_trigger_reason, r.submitted_at,
           p.full_name AS user_name, co.name AS country_name
    FROM public.app_ratings r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.countries co ON co.id = r.country_id
    WHERE (p_stars IS NULL OR r.rating_value = p_stars)
      AND (p_platform IS NULL OR r.platform = p_platform)
      AND (p_role IS NULL OR r.user_role = p_role)
    ORDER BY r.submitted_at DESC
    LIMIT LEAST(p_limit, 200) OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total', v_total, 'limit', p_limit, 'offset', p_offset);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_app_ratings_list(int, int, int, text, text) TO authenticated;
