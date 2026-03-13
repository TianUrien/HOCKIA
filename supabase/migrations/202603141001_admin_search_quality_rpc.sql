-- Search Quality Analytics RPC
-- CTR, zero-click rate, zero-result rate, traditional vs AI comparison

CREATE OR REPLACE FUNCTION admin_get_search_quality(
  p_days INT DEFAULT 30,
  p_exclude_test BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
  v_result JSONB;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH test_ids AS (
    SELECT id FROM profiles WHERE p_exclude_test AND COALESCE(is_test_account, false) = true
  ),
  -- Traditional search events
  trad_searches AS (
    SELECT
      e.id AS search_id,
      e.user_id,
      e.created_at,
      e.properties->>'search_type' AS search_type,
      e.properties->>'search_term' AS search_term,
      COALESCE((e.properties->>'result_count')::int, 0) AS result_count
    FROM events e
    WHERE e.event_name = 'search'
      AND e.created_at >= v_since
      AND e.user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Search result clicks
  trad_clicks AS (
    SELECT
      e.user_id,
      e.created_at,
      e.properties->>'query' AS query,
      e.properties->>'result_type' AS result_type,
      COALESCE((e.properties->>'position')::int, 0) AS position
    FROM events e
    WHERE e.event_name = 'search_result_click'
      AND e.created_at >= v_since
      AND e.user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- AI Discovery searches
  ai_searches AS (
    SELECT
      d.id,
      d.user_id,
      d.query_text,
      d.result_count,
      d.response_time_ms,
      d.created_at
    FROM discovery_events d
    WHERE d.created_at >= v_since
      AND d.user_id NOT IN (SELECT id FROM test_ids)
  ),
  -- Traditional search stats
  trad_stats AS (
    SELECT
      COUNT(*) AS total_searches,
      COUNT(DISTINCT user_id) AS unique_searchers,
      COUNT(*) FILTER (WHERE result_count = 0) AS zero_result_searches,
      ROUND(AVG(result_count)::numeric, 1) AS avg_result_count
    FROM trad_searches
  ),
  -- Click-through stats
  click_stats AS (
    SELECT
      COUNT(DISTINCT tc.user_id || tc.query) AS searches_with_clicks,
      COUNT(*) AS total_clicks,
      ROUND(AVG(tc.position)::numeric, 1) AS avg_click_position
    FROM trad_clicks tc
  ),
  -- AI search stats
  ai_stats AS (
    SELECT
      COUNT(*) AS total_queries,
      COUNT(DISTINCT user_id) AS unique_users,
      COUNT(*) FILTER (WHERE result_count = 0) AS zero_result_queries,
      ROUND(AVG(result_count)::numeric, 1) AS avg_result_count,
      ROUND(AVG(response_time_ms)::numeric, 0) AS avg_response_time_ms
    FROM ai_searches
  ),
  -- Top traditional search queries
  top_queries AS (
    SELECT
      search_term,
      COUNT(*) AS query_count,
      ROUND(AVG(result_count)::numeric, 1) AS avg_results
    FROM trad_searches
    WHERE search_term IS NOT NULL AND search_term != ''
    GROUP BY search_term
    ORDER BY query_count DESC
    LIMIT 20
  ),
  -- Daily trend
  daily_trend AS (
    SELECT
      d::date AS date,
      COALESCE(ts.trad_count, 0) AS traditional_searches,
      COALESCE(ais.ai_count, 0) AS ai_searches
    FROM generate_series(v_since::date, CURRENT_DATE, '1 day'::interval) d
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS trad_count
      FROM trad_searches GROUP BY created_at::date
    ) ts ON ts.day = d::date
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS ai_count
      FROM ai_searches GROUP BY created_at::date
    ) ais ON ais.day = d::date
    ORDER BY d
  )
  SELECT jsonb_build_object(
    'traditional', (SELECT row_to_json(t)::jsonb FROM trad_stats t),
    'ai_discovery', (SELECT row_to_json(a)::jsonb FROM ai_stats a),
    'clicks', (SELECT row_to_json(c)::jsonb FROM click_stats c),
    'click_through_rate', CASE
      WHEN (SELECT total_searches FROM trad_stats) > 0
      THEN ROUND(((SELECT searches_with_clicks FROM click_stats) * 100.0 /
            (SELECT total_searches FROM trad_stats))::numeric, 1)
      ELSE 0
    END,
    'zero_click_rate', CASE
      WHEN (SELECT total_searches FROM trad_stats) > 0
      THEN ROUND((((SELECT total_searches FROM trad_stats) - (SELECT searches_with_clicks FROM click_stats)) * 100.0 /
            (SELECT total_searches FROM trad_stats))::numeric, 1)
      ELSE 0
    END,
    'top_queries', COALESCE((SELECT jsonb_agg(row_to_json(tq)::jsonb) FROM top_queries tq), '[]'::jsonb),
    'daily_trend', COALESCE((SELECT jsonb_agg(row_to_json(dt)::jsonb) FROM daily_trend dt), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_search_quality TO authenticated;
