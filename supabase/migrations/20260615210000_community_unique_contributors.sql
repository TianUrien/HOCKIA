-- ─────────────────────────────────────────────────────────────────────
-- Community analytics — honest "Unique Contributors".
--
-- The Admin Community page showed Unique Contributors as
-- unique_askers + unique_answerers, which DOUBLE-COUNTS anyone who both
-- asked and answered. This adds a true distinct count (users who asked OR
-- answered, deduped) plus total_users so the page can show a real community
-- participation rate (% of users who contributed).
--
-- JSONB return → CREATE OR REPLACE is safe; full body reproduced (from
-- 202603140900) with two new CTEs + two new summary fields.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_get_community_analytics(
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
  v_prev_since TIMESTAMPTZ := v_since - (p_days || ' days')::INTERVAL;
  v_result JSONB;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH test_ids AS (
    SELECT id FROM profiles WHERE p_exclude_test AND COALESCE(is_test_account, false) = true
  ),
  question_stats AS (
    SELECT
      COUNT(*) AS total_questions,
      COUNT(DISTINCT author_id) AS unique_askers
    FROM community_questions
    WHERE created_at >= v_since
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  prev_questions AS (
    SELECT COUNT(*) AS total_questions
    FROM community_questions
    WHERE created_at >= v_prev_since AND created_at < v_since
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  answer_stats AS (
    SELECT
      COUNT(*) AS total_answers,
      COUNT(DISTINCT author_id) AS unique_answerers
    FROM community_answers
    WHERE created_at >= v_since
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  prev_answers AS (
    SELECT COUNT(*) AS total_answers
    FROM community_answers
    WHERE created_at >= v_prev_since AND created_at < v_since
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  -- TRUE distinct contributors: users who asked OR answered in the window
  -- (UNION dedups across both tables, so someone who did both counts once).
  contributor_stats AS (
    SELECT COUNT(*) AS unique_contributors
    FROM (
      SELECT author_id FROM community_questions
      WHERE created_at >= v_since AND author_id NOT IN (SELECT id FROM test_ids)
      UNION
      SELECT author_id FROM community_answers
      WHERE created_at >= v_since AND author_id NOT IN (SELECT id FROM test_ids)
    ) c
  ),
  -- Participation denominator: non-test platform users.
  total_users AS (
    SELECT COUNT(*) AS n FROM profiles WHERE id NOT IN (SELECT id FROM test_ids)
  ),
  response_rate AS (
    SELECT
      COUNT(*) AS total_q,
      COUNT(*) FILTER (WHERE answer_count > 0) AS answered_q
    FROM community_questions
    WHERE created_at >= v_since
      AND author_id NOT IN (SELECT id FROM test_ids)
  ),
  questions_by_role AS (
    SELECT
      p.role,
      COUNT(*) AS count
    FROM community_questions q
    JOIN profiles p ON q.author_id = p.id
    WHERE q.created_at >= v_since
      AND q.author_id NOT IN (SELECT id FROM test_ids)
    GROUP BY p.role
    ORDER BY count DESC
  ),
  top_contributors AS (
    SELECT
      p.id,
      p.full_name,
      p.role,
      p.avatar_url,
      COUNT(*) AS answer_count
    FROM community_answers a
    JOIN profiles p ON a.author_id = p.id
    WHERE a.created_at >= v_since
      AND a.author_id NOT IN (SELECT id FROM test_ids)
    GROUP BY p.id, p.full_name, p.role, p.avatar_url
    ORDER BY answer_count DESC
    LIMIT 10
  ),
  daily_trend AS (
    SELECT
      d.day::date AS day,
      COALESCE(q.cnt, 0) AS questions,
      COALESCE(a.cnt, 0) AS answers
    FROM generate_series(v_since::date, CURRENT_DATE, '1 day') AS d(day)
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS cnt
      FROM community_questions
      WHERE created_at >= v_since AND author_id NOT IN (SELECT id FROM test_ids)
      GROUP BY 1
    ) q ON q.day = d.day
    LEFT JOIN (
      SELECT created_at::date AS day, COUNT(*) AS cnt
      FROM community_answers
      WHERE created_at >= v_since AND author_id NOT IN (SELECT id FROM test_ids)
      GROUP BY 1
    ) a ON a.day = d.day
    ORDER BY d.day
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'total_questions', qs.total_questions,
        'unique_askers', qs.unique_askers,
        'prev_total_questions', pq.total_questions,
        'total_answers', ans.total_answers,
        'unique_answerers', ans.unique_answerers,
        'prev_total_answers', pa.total_answers,
        'unique_contributors', cs.unique_contributors,
        'total_users', tu.n,
        'response_rate', CASE WHEN rr.total_q > 0 THEN ROUND((rr.answered_q::numeric / rr.total_q) * 100, 1) ELSE 0 END
      )
      FROM question_stats qs, prev_questions pq, answer_stats ans, prev_answers pa,
           contributor_stats cs, total_users tu, response_rate rr
    ),
    'questions_by_role', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', role, 'count', count)) FROM questions_by_role), '[]'::jsonb),
    'top_contributors', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'full_name', full_name, 'role', role, 'avatar_url', avatar_url, 'answer_count', answer_count
    )) FROM top_contributors), '[]'::jsonb),
    'daily_trend', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', day, 'questions', questions, 'answers', answers)) FROM daily_trend), '[]'::jsonb),
    'generated_at', NOW()
  ) INTO v_result;

  RETURN v_result;
END;
$$;
