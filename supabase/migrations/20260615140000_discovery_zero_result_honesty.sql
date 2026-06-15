-- ─────────────────────────────────────────────────────────────────────
-- Discovery zero-result honesty: distinguish REAL failed searches from the
-- many "0 cards" responses that are correct (greetings, advice, "my
-- applicants" recommendations, clarifying questions, errors).
--
-- The old metric counted result_count=0 AND intent='search' — but the
-- "Show me my best applicants" handler rows ALSO have intent='search' (with
-- parsed_filters._meta.kind='recommendation'), so they were wrongly counted
-- as failed searches, inflating the displayed zero-result number.
--
-- Fix: a priority-ordered classifier (recommendation/clarifying/redirect/
-- error/knowledge/conversational checked BEFORE real_no_result) assigns each
-- result_count=0 row to exactly ONE bucket. The RPC now exposes:
--   * true_zero_result_queries — only the 'real_no_result' bucket (genuine
--     "searched, nothing matched" — the actionable supply/over-filter gaps)
--   * failure_breakdown — every 0-card query categorised, so the page can
--     show WHY 0 cards (most are not failures)
--   * the zero_result_queries LIST is narrowed to real_no_result + carries
--     meta_kind, so it only surfaces the searches worth investigating.
-- No new tracking — _meta.kind is already logged by nl-search.
-- ─────────────────────────────────────────────────────────────────────

-- Reusable, mutually-exclusive classifier for a 0-card discovery query.
-- Priority order matters: 'recommendation'/'clarifying'/'canned_redirect'/
-- 'error' must win over the intent='search' those rows can also carry.
CREATE OR REPLACE FUNCTION public.discovery_zero_result_category(
  p_intent TEXT,
  p_parsed_filters JSONB,
  p_error_message TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_parsed_filters->'_meta'->>'kind' = 'recommendation' THEN 'recommendation'
    WHEN p_parsed_filters->'_meta'->>'kind' = 'clarifying_question' OR p_intent = 'clarifying_redirect' THEN 'clarifying'
    WHEN p_parsed_filters->'_meta'->>'kind' = 'canned_redirect' OR p_intent = 'canned_redirect' THEN 'canned_redirect'
    WHEN p_parsed_filters->'_meta'->>'kind' = 'soft_error' OR p_intent = 'error' OR p_error_message IS NOT NULL THEN 'error'
    WHEN p_intent = 'knowledge' OR p_parsed_filters->'_meta'->>'kind' = 'knowledge' THEN 'knowledge'
    WHEN p_intent = 'conversation' OR p_parsed_filters->'_meta'->>'kind' = 'text' THEN 'conversational'
    WHEN p_intent IN ('search', 'search_fallback') OR p_parsed_filters->'_meta'->>'kind' IN ('no_results', 'search') THEN 'real_no_result'
    ELSE 'other'
  END
$$;

CREATE OR REPLACE FUNCTION public.admin_get_discovery_analytics(
  p_days INT DEFAULT 30,
  p_exclude_test BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := now() - (p_days || ' days')::INTERVAL;
  v_summary JSONB;
  v_failure_breakdown JSONB;
  v_intent_breakdown JSONB;
  v_filter_frequency JSONB;
  v_daily_trend JSONB;
  v_top_users JSONB;
  v_zero_result_queries JSONB;
  v_recent_queries JSONB;
BEGIN
  -- Admin-only check
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── Summary stats ─────────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'total_queries', COALESCE(COUNT(*), 0),
    'unique_users', COALESCE(COUNT(DISTINCT de.user_id), 0),
    'avg_result_count', COALESCE(
      ROUND(AVG(de.result_count) FILTER (WHERE de.intent = 'search'), 1), 0
    ),
    -- Legacy field kept for backward compat (result_count=0 AND intent='search').
    'zero_result_queries', COALESCE(
      COUNT(*) FILTER (WHERE de.result_count = 0 AND de.intent = 'search'), 0
    ),
    -- Every 0-card query, regardless of intent (the failure_breakdown denominator).
    'zero_result_total', COALESCE(
      COUNT(*) FILTER (WHERE de.result_count = 0), 0
    ),
    -- The HONEST number: searches that genuinely matched nothing.
    'true_zero_result_queries', COALESCE(
      COUNT(*) FILTER (
        WHERE de.result_count = 0
          AND public.discovery_zero_result_category(de.intent, de.parsed_filters, de.error_message) = 'real_no_result'
      ), 0
    ),
    'avg_response_time_ms', COALESCE(ROUND(AVG(de.response_time_ms)), 0),
    'error_count', COALESCE(
      COUNT(*) FILTER (WHERE de.error_message IS NOT NULL), 0
    )
  )
  INTO v_summary
  FROM discovery_events de
  LEFT JOIN profiles p ON p.id = de.user_id
  WHERE de.created_at >= v_since
    AND (NOT p_exclude_test OR COALESCE(p.is_test_account, false) = false);

  -- ── Failure breakdown: every 0-card query bucketed (mutually exclusive) ─
  SELECT COALESCE(
    jsonb_object_agg(bucket, jsonb_build_object('count', cnt, 'percentage', pct)),
    '{}'::jsonb
  )
  INTO v_failure_breakdown
  FROM (
    SELECT
      bucket,
      COUNT(*) AS cnt,
      ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER(), 0) * 100, 1) AS pct
    FROM (
      SELECT public.discovery_zero_result_category(de.intent, de.parsed_filters, de.error_message) AS bucket
      FROM discovery_events de
      LEFT JOIN profiles p ON p.id = de.user_id
      WHERE de.result_count = 0
        AND de.created_at >= v_since
        AND (NOT p_exclude_test OR COALESCE(p.is_test_account, false) = false)
    ) classified
    GROUP BY bucket
  ) agg;

  -- ── Intent breakdown ──────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.count DESC), '[]'::jsonb)
  INTO v_intent_breakdown
  FROM (
    SELECT
      de.intent,
      COUNT(*) AS count,
      ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER(), 0) * 100, 1) AS percentage
    FROM discovery_events de
    LEFT JOIN profiles p ON p.id = de.user_id
    WHERE de.created_at >= v_since
      AND (NOT p_exclude_test OR COALESCE(p.is_test_account, false) = false)
    GROUP BY de.intent
  ) sub;

  -- ── Filter frequency ──────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.count DESC), '[]'::jsonb)
  INTO v_filter_frequency
  FROM (
    SELECT filter_name, COUNT(*) AS count
    FROM (
      SELECT unnest(ARRAY[
        CASE WHEN de.parsed_filters->'roles' IS NOT NULL
             AND jsonb_array_length(de.parsed_filters->'roles') > 0
             THEN 'roles' END,
        CASE WHEN de.parsed_filters->'positions' IS NOT NULL
             AND jsonb_array_length(de.parsed_filters->'positions') > 0
             THEN 'positions' END,
        CASE WHEN de.parsed_filters->>'gender' IS NOT NULL
             AND de.parsed_filters->>'gender' != ''
             THEN 'gender' END,
        CASE WHEN (de.parsed_filters->>'min_age')::int IS NOT NULL
             OR (de.parsed_filters->>'max_age')::int IS NOT NULL
             THEN 'age' END,
        CASE WHEN de.parsed_filters->'nationalities' IS NOT NULL
             AND jsonb_array_length(de.parsed_filters->'nationalities') > 0
             THEN 'nationalities' END,
        CASE WHEN de.parsed_filters->'locations' IS NOT NULL
             AND jsonb_array_length(de.parsed_filters->'locations') > 0
             THEN 'locations' END,
        CASE WHEN de.parsed_filters->'leagues' IS NOT NULL
             AND jsonb_array_length(de.parsed_filters->'leagues') > 0
             THEN 'leagues' END,
        CASE WHEN de.parsed_filters->'countries' IS NOT NULL
             AND jsonb_array_length(de.parsed_filters->'countries') > 0
             THEN 'countries' END,
        CASE WHEN (de.parsed_filters->>'eu_passport')::boolean = true
             THEN 'eu_passport' END,
        CASE WHEN de.parsed_filters->>'availability' IS NOT NULL
             AND de.parsed_filters->>'availability' != ''
             THEN 'availability' END,
        CASE WHEN (de.parsed_filters->>'min_references')::int > 0
             THEN 'references' END,
        CASE WHEN (de.parsed_filters->>'min_career_entries')::int > 0
             THEN 'career_entries' END,
        CASE WHEN de.parsed_filters->>'text_query' IS NOT NULL
             AND de.parsed_filters->>'text_query' != ''
             THEN 'text_query' END
      ]) AS filter_name
      FROM discovery_events de
      LEFT JOIN profiles p ON p.id = de.user_id
      WHERE de.intent = 'search'
        AND de.parsed_filters IS NOT NULL
        AND de.created_at >= v_since
        AND (NOT p_exclude_test OR COALESCE(p.is_test_account, false) = false)
    ) expanded
    WHERE filter_name IS NOT NULL
    GROUP BY filter_name
  ) sub;

  -- ── Daily trend ───────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.date), '[]'::jsonb)
  INTO v_daily_trend
  FROM (
    SELECT
      de.created_at::date AS date,
      COUNT(*) AS queries,
      COUNT(DISTINCT de.user_id) AS unique_users
    FROM discovery_events de
    LEFT JOIN profiles p ON p.id = de.user_id
    WHERE de.created_at >= v_since
      AND (NOT p_exclude_test OR COALESCE(p.is_test_account, false) = false)
    GROUP BY de.created_at::date
    ORDER BY de.created_at::date
  ) sub;

  -- ── Top users (max 50) ────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.query_count DESC), '[]'::jsonb)
  INTO v_top_users
  FROM (
    SELECT
      de.user_id,
      p.full_name AS display_name,
      p.email,
      p.role,
      p.avatar_url,
      COUNT(*) AS query_count,
      MAX(de.created_at) AS last_query_at
    FROM discovery_events de
    JOIN profiles p ON p.id = de.user_id
    WHERE de.created_at >= v_since
      AND (NOT p_exclude_test OR COALESCE(p.is_test_account, false) = false)
    GROUP BY de.user_id, p.full_name, p.email, p.role, p.avatar_url
    ORDER BY COUNT(*) DESC
    LIMIT 50
  ) sub;

  -- ── Zero-result queries list: REAL failed searches only (most recent 50) ─
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.created_at DESC), '[]'::jsonb)
  INTO v_zero_result_queries
  FROM (
    SELECT
      de.id,
      de.user_id,
      p.full_name AS display_name,
      de.query_text,
      de.intent,
      de.parsed_filters,
      (de.parsed_filters->'_meta'->>'kind') AS meta_kind,
      de.created_at
    FROM discovery_events de
    LEFT JOIN profiles p ON p.id = de.user_id
    WHERE de.result_count = 0
      AND public.discovery_zero_result_category(de.intent, de.parsed_filters, de.error_message) = 'real_no_result'
      AND de.created_at >= v_since
      AND (NOT p_exclude_test OR COALESCE(p.is_test_account, false) = false)
    ORDER BY de.created_at DESC
    LIMIT 50
  ) sub;

  -- ── Recent queries (most recent 100) ──────────────────────────────────
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.created_at DESC), '[]'::jsonb)
  INTO v_recent_queries
  FROM (
    SELECT
      de.id,
      de.user_id,
      p.full_name AS display_name,
      de.role,
      de.query_text,
      de.intent,
      de.result_count,
      de.parsed_filters,
      de.response_time_ms,
      de.created_at
    FROM discovery_events de
    LEFT JOIN profiles p ON p.id = de.user_id
    WHERE de.created_at >= v_since
      AND (NOT p_exclude_test OR COALESCE(p.is_test_account, false) = false)
    ORDER BY de.created_at DESC
    LIMIT 100
  ) sub;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'failure_breakdown', v_failure_breakdown,
    'intent_breakdown', v_intent_breakdown,
    'filter_frequency', v_filter_frequency,
    'daily_trend', v_daily_trend,
    'top_users', v_top_users,
    'zero_result_queries', v_zero_result_queries,
    'recent_queries', v_recent_queries,
    'period_days', p_days,
    'generated_at', now()
  );
END;
$$;
