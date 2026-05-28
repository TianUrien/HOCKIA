-- ─────────────────────────────────────────────────────────────────────
-- Admin AI Opinion Analytics — internal dashboard data layer
-- ─────────────────────────────────────────────────────────────────────
-- Surfaces ai_opinions + ai_opinion_feedback in the /admin portal so
-- the team can read recruiter feedback without going to Supabase SQL,
-- and watch prompt-version performance over time. Complements GA4 —
-- this is the source-of-truth qualitative data (verdict text, reason
-- text), GA4 is the behavioral funnel.
--
-- Two SECURITY DEFINER RPCs, both gated on is_platform_admin():
--
--   admin_get_ai_opinion_metrics(p_days)
--     One-shot dashboard payload — daily generation counts, prompt
--     version + model split, feedback breakdown, top down-vote
--     recruiters. Returns JSONB so the page can fan it out into
--     multiple charts without N round-trips.
--
--   admin_get_recent_ai_opinion_feedback(p_limit, p_offset, p_rating)
--     Paginated feedback rows joined to the underlying opinion +
--     both profiles. Lets the admin scan negative reasons fast,
--     filter by rating, and see which prompt_version produced the
--     opinion being criticised.

BEGIN;

-- ── admin_get_ai_opinion_metrics ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_ai_opinion_metrics(
  p_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since TIMESTAMPTZ := timezone('utc', now()) - (p_days || ' days')::INTERVAL;
  v_summary JSONB;
  v_daily JSONB;
  v_by_version JSONB;
  v_by_model JSONB;
  v_feedback JSONB;
  v_top_quota JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── Headline summary ──────────────────────────────────────────────
  SELECT jsonb_build_object(
    'total_fresh_generations', COALESCE(COUNT(*), 0),
    'unique_recruiters', COALESCE(COUNT(DISTINCT viewer_id), 0),
    'unique_players_evaluated', COALESCE(COUNT(DISTINCT player_id), 0),
    'still_fresh_count', COALESCE(COUNT(*) FILTER (WHERE expires_at > timezone('utc', now())), 0)
  )
  INTO v_summary
  FROM public.ai_opinions
  WHERE created_at >= v_since;

  -- ── Daily generation trend ────────────────────────────────────────
  -- Plain time-series so the line chart is one direct mapping.
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.day), '[]'::jsonb)
  INTO v_daily
  FROM (
    SELECT
      to_char(date_trunc('day', created_at AT TIME ZONE 'utc'), 'YYYY-MM-DD') AS day,
      COUNT(*) AS generations
    FROM public.ai_opinions
    WHERE created_at >= v_since
    GROUP BY date_trunc('day', created_at AT TIME ZONE 'utc')
  ) sub;

  -- ── Generations by prompt_version ─────────────────────────────────
  -- Lets us SEE whether v1.2 outperformed v1.1, etc.
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.generations DESC), '[]'::jsonb)
  INTO v_by_version
  FROM (
    SELECT prompt_version, COUNT(*) AS generations
    FROM public.ai_opinions
    WHERE created_at >= v_since
    GROUP BY prompt_version
  ) sub;

  -- ── Generations by model ──────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.generations DESC), '[]'::jsonb)
  INTO v_by_model
  FROM (
    SELECT model, COUNT(*) AS generations
    FROM public.ai_opinions
    WHERE created_at >= v_since
    GROUP BY model
  ) sub;

  -- ── Feedback breakdown ────────────────────────────────────────────
  -- up / down totals, with-reason rates, breakdown by prompt_version.
  SELECT jsonb_build_object(
    'total_rated', COALESCE(COUNT(*), 0),
    'up_count', COALESCE(COUNT(*) FILTER (WHERE f.rating = 'up'), 0),
    'down_count', COALESCE(COUNT(*) FILTER (WHERE f.rating = 'down'), 0),
    'down_with_reason', COALESCE(COUNT(*) FILTER (WHERE f.rating = 'down' AND f.reason IS NOT NULL AND length(trim(f.reason)) > 0), 0),
    'by_version', COALESCE((
      SELECT jsonb_agg(row_to_json(sub2)::jsonb ORDER BY sub2.prompt_version)
      FROM (
        SELECT
          o.prompt_version,
          COUNT(*) FILTER (WHERE f2.rating = 'up') AS up_count,
          COUNT(*) FILTER (WHERE f2.rating = 'down') AS down_count
        FROM public.ai_opinion_feedback f2
        JOIN public.ai_opinions o ON o.id = f2.opinion_id
        WHERE f2.created_at >= v_since
        GROUP BY o.prompt_version
      ) sub2
    ), '[]'::jsonb)
  )
  INTO v_feedback
  FROM public.ai_opinion_feedback f
  WHERE f.created_at >= v_since;

  -- ── Top quota burners ─────────────────────────────────────────────
  -- Which recruiters generate the most? Useful for spotting power
  -- users vs runaway loops. Joined to profiles for the name.
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.generations DESC), '[]'::jsonb)
  INTO v_top_quota
  FROM (
    SELECT
      o.viewer_id,
      p.full_name AS viewer_name,
      p.role AS viewer_role,
      COUNT(*) AS generations
    FROM public.ai_opinions o
    LEFT JOIN public.profiles p ON p.id = o.viewer_id
    WHERE o.created_at >= v_since
    GROUP BY o.viewer_id, p.full_name, p.role
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'daily', v_daily,
    'by_version', v_by_version,
    'by_model', v_by_model,
    'feedback', v_feedback,
    'top_recruiters', v_top_quota,
    'window_days', p_days,
    'generated_at', timezone('utc', now())
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_ai_opinion_metrics(INT) IS
  'Admin-only dashboard payload for AI Opinion analytics. Returns daily generations, prompt_version + model splits, feedback breakdown, top recruiters. p_days defaults to 30.';

GRANT EXECUTE ON FUNCTION public.admin_get_ai_opinion_metrics(INT) TO authenticated;

-- ── admin_get_recent_ai_opinion_feedback ────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_recent_ai_opinion_feedback(
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_rating TEXT DEFAULT NULL -- 'up' | 'down' | NULL (all)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows JSONB;
  v_total INT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_rating IS NOT NULL AND p_rating NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'p_rating must be ''up'', ''down'', or NULL';
  END IF;

  -- Cap limit defensively — page UI should never request thousands.
  IF p_limit > 200 THEN p_limit := 200; END IF;
  IF p_limit < 1 THEN p_limit := 1; END IF;
  IF p_offset < 0 THEN p_offset := 0; END IF;

  SELECT COUNT(*)::INT
  INTO v_total
  FROM public.ai_opinion_feedback f
  WHERE p_rating IS NULL OR f.rating = p_rating;

  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.feedback_created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      f.id AS feedback_id,
      f.rating,
      f.reason,
      f.created_at AS feedback_created_at,
      f.updated_at AS feedback_updated_at,
      o.id AS opinion_id,
      o.verdict_short,
      o.citations,
      o.prompt_version,
      o.model,
      o.created_at AS opinion_created_at,
      o.viewer_id,
      vp.full_name AS viewer_name,
      vp.role AS viewer_role,
      o.player_id,
      pp.full_name AS player_name,
      pp.role AS player_role
    FROM public.ai_opinion_feedback f
    JOIN public.ai_opinions o   ON o.id = f.opinion_id
    LEFT JOIN public.profiles vp ON vp.id = f.viewer_id
    LEFT JOIN public.profiles pp ON pp.id = o.player_id
    WHERE p_rating IS NULL OR f.rating = p_rating
    ORDER BY f.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'rating_filter', p_rating
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_recent_ai_opinion_feedback(INT, INT, TEXT) IS
  'Admin-only paginated feedback rows joined to the underlying opinion + viewer/player profiles. Filterable by rating.';

GRANT EXECUTE ON FUNCTION public.admin_get_recent_ai_opinion_feedback(INT, INT, TEXT) TO authenticated;

COMMIT;
