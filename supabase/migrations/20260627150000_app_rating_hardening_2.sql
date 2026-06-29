-- App rating — confirmatory-audit hardening (round 2). STAGING FIRST.
-- Fixes a regression the first hardening introduced + a metric-definition flaw.

-- ── #1 submit_app_rating: ALWAYS converge prompt state (self-heal) ────────────
-- The earlier early-return returned the existing id WITHOUT stamping state, so a
-- user with a rating row but a missing/stale state row could be re-prompted
-- forever (should_show reads state, not app_ratings). Now state always converges,
-- and the return distinguishes a genuine insert from a no-op (for honest analytics).
DROP FUNCTION IF EXISTS public.submit_app_rating(smallint, text, text, text, text, text, text);
CREATE FUNCTION public.submit_app_rating(
  p_rating_value  smallint,
  p_feedback_text text DEFAULT NULL,
  p_platform      text DEFAULT NULL,
  p_app_version   text DEFAULT NULL,
  p_build_number  text DEFAULT NULL,
  p_environment   text DEFAULT NULL,
  p_trigger_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_role     text;
  v_country  int;
  v_id       uuid;
  v_existing uuid;
  v_inserted boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF p_rating_value IS NULL OR p_rating_value < 1 OR p_rating_value > 5 THEN
    RAISE EXCEPTION 'invalid_rating';
  END IF;

  SELECT id INTO v_existing FROM public.app_ratings WHERE user_id = v_uid LIMIT 1;
  IF v_existing IS NOT NULL THEN
    v_id := v_existing;                       -- one rating per user, ever
  ELSE
    SELECT role, COALESCE(nationality_country_id, base_country_id)
      INTO v_role, v_country FROM public.profiles WHERE id = v_uid;
    INSERT INTO public.app_ratings
      (user_id, rating_value, feedback_text, user_role, country_id, platform, app_version, build_number, environment, prompt_trigger_reason)
    VALUES
      (v_uid, p_rating_value, NULLIF(btrim(COALESCE(p_feedback_text, '')), ''), v_role, v_country,
       p_platform, p_app_version, p_build_number, p_environment, p_trigger_reason)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.app_ratings WHERE user_id = v_uid LIMIT 1;  -- lost a concurrent race
    ELSE
      v_inserted := true;
    END IF;
  END IF;

  -- Always converge state so a user who has a rating is never re-prompted, even if
  -- their state row was missing/stale. Preserve the original rated_at if present.
  INSERT INTO public.app_rating_prompt_state (user_id, rated, rated_at, rating_id, do_not_ask, updated_at)
  VALUES (v_uid, true, timezone('utc', now()), v_id, true, timezone('utc', now()))
  ON CONFLICT (user_id) DO UPDATE
    SET rated = true,
        rated_at = COALESCE(public.app_rating_prompt_state.rated_at, timezone('utc', now())),
        rating_id = v_id, do_not_ask = true, updated_at = timezone('utc', now());

  RETURN jsonb_build_object('rating_id', v_id, 'inserted', v_inserted);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_app_rating(smallint, text, text, text, text, text, text) TO authenticated;

-- ── #1 defense-in-depth: a rating row is authoritative in should_show ─────────
CREATE OR REPLACE FUNCTION public.should_show_app_rating_prompt()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_onboarded boolean;
  v_active    int;
  v_since     int;
  v_state     public.app_rating_prompt_state%ROWTYPE;
  v_today     date := (timezone('utc', now()))::date;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('show', false, 'reason', 'no_user');
  END IF;

  SELECT onboarding_completed INTO v_onboarded FROM public.profiles WHERE id = v_uid;
  IF NOT COALESCE(v_onboarded, false) THEN
    RETURN jsonb_build_object('show', false, 'reason', 'not_onboarded');
  END IF;

  SELECT * INTO v_state FROM public.app_rating_prompt_state WHERE user_id = v_uid;
  IF v_state.rated THEN
    RETURN jsonb_build_object('show', false, 'reason', 'already_rated');
  END IF;
  -- A rating row is authoritative even if the state row drifted (out-of-band insert,
  -- import, partial failure) — never re-prompt someone who already rated.
  IF EXISTS (SELECT 1 FROM public.app_ratings WHERE user_id = v_uid) THEN
    RETURN jsonb_build_object('show', false, 'reason', 'already_rated');
  END IF;
  IF COALESCE(v_state.do_not_ask, false) THEN
    RETURN jsonb_build_object('show', false, 'reason', 'capped');
  END IF;
  IF v_state.last_shown_at IS NOT NULL AND v_state.last_shown_at::date = v_today THEN
    RETURN jsonb_build_object('show', false, 'reason', 'shown_today');
  END IF;

  SELECT COUNT(DISTINCT date) INTO v_active FROM public.user_engagement_daily WHERE user_id = v_uid;
  IF v_active < 7 THEN
    RETURN jsonb_build_object('show', false, 'reason', 'insufficient_active_days', 'active_days', v_active);
  END IF;

  IF v_state.last_dismissed_at IS NOT NULL THEN
    SELECT COUNT(DISTINCT date) INTO v_since
    FROM public.user_engagement_daily
    WHERE user_id = v_uid AND date > v_state.last_dismissed_at::date;
    IF v_since < 10 THEN
      RETURN jsonb_build_object('show', false, 'reason', 'backoff', 'active_days_since_dismiss', v_since);
    END IF;
  END IF;

  RETURN jsonb_build_object('show', true, 'reason', 'eligible', 'active_days', v_active,
                            'trigger', 'onboarded_7_active_days');
END;
$$;
GRANT EXECUTE ON FUNCTION public.should_show_app_rating_prompt() TO authenticated;

-- ── #1 backfill: stamp state for every existing rating (fix already-diverged rows)
INSERT INTO public.app_rating_prompt_state (user_id, rated, rated_at, rating_id, do_not_ask, updated_at)
SELECT r.user_id, true, r.submitted_at, r.id, true, timezone('utc', now())
FROM public.app_ratings r
ON CONFLICT (user_id) DO UPDATE
  SET rated = true,
      rated_at = COALESCE(public.app_rating_prompt_state.rated_at, EXCLUDED.rated_at),
      rating_id = EXCLUDED.rating_id, do_not_ask = true, updated_at = timezone('utc', now());

-- ── #2 conversion over a coherent cohort (no longer >100%-prone) ──────────────
-- Numerator = distinct users SHOWN a prompt in the window who have a rating;
-- denominator = distinct users shown in the window. Numerator ⊆ denominator, so
-- the ratio is always 0-100% and is a real per-cohort conversion.
CREATE OR REPLACE FUNCTION public.admin_get_app_ratings_metrics(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_since      timestamptz := timezone('utc', now()) - (p_days || ' days')::interval;
  v_shown      int; v_users_shown int; v_dismissed int; v_submitted int; v_converted int;
  v_summary    jsonb; v_dist jsonb; v_daily jsonb;
  v_by_role    jsonb; v_by_platform jsonb; v_by_version jsonb; v_by_country jsonb;
  v_eligible   int;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT COUNT(*) FILTER (WHERE event_name = 'app_rating_prompt_shown'),
         COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'app_rating_prompt_shown'),
         COUNT(*) FILTER (WHERE event_name = 'app_rating_prompt_dismissed')
    INTO v_shown, v_users_shown, v_dismissed
  FROM public.events
  WHERE created_at >= v_since AND event_name LIKE 'app_rating_prompt_%';

  SELECT COUNT(*) INTO v_submitted FROM public.app_ratings WHERE submitted_at >= v_since;

  -- Coherent conversion cohort: of users shown in the window, how many have a rating.
  SELECT COUNT(*) INTO v_converted FROM (
    SELECT DISTINCT e.user_id
    FROM public.events e
    WHERE e.event_name = 'app_rating_prompt_shown' AND e.created_at >= v_since AND e.user_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.app_ratings r WHERE r.user_id = e.user_id)
  ) c;

  v_summary := jsonb_build_object(
    'avg_rating', (SELECT round(avg(rating_value)::numeric, 2) FROM public.app_ratings WHERE submitted_at >= v_since),
    'total_ratings', v_submitted,
    'prompts_shown', v_shown,
    'unique_users_shown', v_users_shown,
    'prompts_dismissed', v_dismissed,
    'conversion_rate', CASE WHEN v_users_shown > 0 THEN LEAST(round((v_converted::numeric / v_users_shown) * 100, 1), 100) ELSE 0 END,
    'dismissal_rate',  CASE WHEN v_shown > 0 THEN LEAST(round((v_dismissed::numeric / v_shown) * 100, 1), 100) ELSE 0 END
  );

  SELECT jsonb_agg(jsonb_build_object('rating', g.r,
           'count', (SELECT COUNT(*) FROM public.app_ratings a WHERE a.rating_value = g.r AND a.submitted_at >= v_since)
         ) ORDER BY g.r)
    INTO v_dist FROM generate_series(1, 5) g(r);

  SELECT jsonb_agg(jsonb_build_object('day', d,
           'submitted', (SELECT COUNT(*) FROM public.app_ratings a WHERE a.submitted_at::date = d),
           'shown',     (SELECT COUNT(*) FROM public.events e WHERE e.event_name = 'app_rating_prompt_shown' AND e.created_at::date = d),
           'dismissed', (SELECT COUNT(*) FROM public.events e WHERE e.event_name = 'app_rating_prompt_dismissed' AND e.created_at::date = d)
         ) ORDER BY d)
    INTO v_daily
  FROM generate_series(v_since::date, (timezone('utc', now()))::date, '1 day') d;

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

  WITH eligible AS (
    SELECT user_id FROM public.user_engagement_daily GROUP BY user_id HAVING COUNT(DISTINCT date) >= 7
  )
  SELECT COUNT(*) INTO v_eligible
  FROM eligible e
  JOIN public.profiles p ON p.id = e.user_id AND p.onboarding_completed = true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.app_rating_prompt_state s
    WHERE s.user_id = e.user_id AND (s.shown_count > 0 OR s.rated)
  )
  AND NOT EXISTS (SELECT 1 FROM public.app_ratings r WHERE r.user_id = e.user_id);

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
