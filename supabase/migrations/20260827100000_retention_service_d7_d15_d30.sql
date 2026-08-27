-- ════════════════════════════════════════════════════════════════════════
-- Retention service — one definition behind D7 / D15 / D30
--
-- Before this, the Overview's "D7 Retention" card and the Retention tab each
-- computed their own number: the card divided by a fixed 7-day signup slice
-- and returned 0 when nobody was old enough yet (so an immature cohort read
-- as a catastrophic 0%), while admin_get_retention_cohorts/by_role used a
-- different, eligibility-aware definition. Two answers to the same question.
--
-- Everything now flows through ONE calculation:
--   retention_is_eligible()  — has this member aged enough to be measured?
--   retention_day_matches()  — does this activity day count as the return?
-- Both are pure and inlinable, so the aggregate RPCs, the cohort table and
-- the CSV export are the same arithmetic by construction, and the predicates
-- can be unit-tested with synthetic dates (src/__tests__/db/retention.test.ts).
--
-- DEFINITIONS (surfaced verbatim in the UI tooltips)
--   Cohort entry .... profiles.created_at (account created).
--   Timezone ........ UTC everywhere. Every timestamptz is converted with
--                     AT TIME ZONE 'UTC' before being cast to a date, so a
--                     cohort boundary never moves with the reader's locale.
--   Eligibility ..... a member counts toward Day N only once the measurement
--                     window has fully elapsed — never partially observed.
--   Return methods ..
--     'bracket'     (default, HOCKIA's existing product-wide definition):
--                    returned at any point in days N…N+6 — "came back during
--                    that week". Eligible once day N+6 is in the past.
--     'on'          (Amplitude "Return On"): returned exactly on day N.
--                    Eligible once day N is in the past.
--     'on_or_after' (Amplitude "Return On or After"): returned on day N or
--                    any later day. Eligible once day N has arrived. Older
--                    cohorts have had more chances to qualify, so only
--                    compare cohorts of similar age with this method.
--   Activity ........
--     'any'         — a real authenticated session (user_engagement_daily).
--     'meaningful'  — at least one core action that day: applied to an
--                     opportunity, sent a message, connected, shortlisted or
--                     saved someone, posted or commented, requested or gave a
--                     reference, ran a search, viewed an opportunity or an
--                     application, published an opportunity, edited a profile.
--   Excluded ........ test accounts, blocked accounts, frozen minors.
--
-- NULL, never 0: every percentage is NULL when its eligible denominator is 0,
-- so the UI can say "not enough eligible data" instead of inventing a zero.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. The definition, as pure functions ────────────────────────────────
-- No table access and no SECURITY DEFINER: they run as the caller and can be
-- granted broadly, which is what lets the DB test suite assert the exact
-- boundary behaviour with synthetic dates.

CREATE OR REPLACE FUNCTION public.retention_window_end(p_day integer, p_method text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE WHEN p_method = 'bracket' THEN p_day + 6 ELSE p_day END
$$;

COMMENT ON FUNCTION public.retention_window_end(integer, text) IS
  'Last day of the Day-N measurement window: N+6 for the bracket method, N otherwise.';

CREATE OR REPLACE FUNCTION public.retention_is_eligible(
  p_cohort_date date,
  p_day         integer,
  p_method      text,
  p_today       date
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    -- Open-ended window: day N only has to have arrived.
    WHEN p_method = 'on_or_after' THEN p_cohort_date + p_day <= p_today
    -- Closed window: it must be entirely in the past, so a member is never
    -- counted as "did not return" while they could still return today.
    ELSE p_cohort_date + public.retention_window_end(p_day, p_method) < p_today
  END
$$;

COMMENT ON FUNCTION public.retention_is_eligible(date, integer, text, date) IS
  'True once the Day-N measurement window has fully elapsed for this cohort date (UTC).';

CREATE OR REPLACE FUNCTION public.retention_day_matches(
  p_activity_date date,
  p_cohort_date   date,
  p_day           integer,
  p_method        text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_method = 'on'          THEN p_activity_date =  p_cohort_date + p_day
    WHEN p_method = 'on_or_after' THEN p_activity_date >= p_cohort_date + p_day
    ELSE p_activity_date BETWEEN p_cohort_date + p_day
                             AND p_cohort_date + public.retention_window_end(p_day, 'bracket')
  END
$$;

COMMENT ON FUNCTION public.retention_day_matches(date, date, integer, text) IS
  'True when an activity day counts as the Day-N return under the given method.';

GRANT EXECUTE ON FUNCTION public.retention_window_end(integer, text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.retention_is_eligible(date, integer, text, date)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.retention_day_matches(date, date, integer, text)   TO authenticated;

-- ── 2. Per-member facts (internal; never exposed to the Data API) ────────

CREATE OR REPLACE FUNCTION public.admin_retention_facts(
  p_days        integer[] DEFAULT ARRAY[7, 15, 30],
  p_activity    text      DEFAULT 'any',
  p_method      text      DEFAULT 'bracket',
  p_cohort_from date      DEFAULT NULL,
  p_cohort_to   date      DEFAULT NULL,
  p_role        text      DEFAULT NULL,
  p_country_id  integer   DEFAULT NULL,
  p_platform    text      DEFAULT NULL,
  p_source      text      DEFAULT NULL
)
RETURNS TABLE (
  user_id     uuid,
  cohort_date date,
  role        text,
  day_n       integer,
  eligible    boolean,
  retained    boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
-- The OUT parameters share names with columns below (cohort_date, day_n,
-- eligible, retained); resolve any bare reference to the column.
#variable_conflict use_column
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_method NOT IN ('bracket', 'on', 'on_or_after') THEN
    RAISE EXCEPTION 'Unknown retention method: %', p_method;
  END IF;
  IF p_activity NOT IN ('any', 'meaningful') THEN
    RAISE EXCEPTION 'Unknown activity mode: %', p_activity;
  END IF;
  IF p_days IS NULL OR array_length(p_days, 1) IS NULL OR array_length(p_days, 1) > 8 THEN
    RAISE EXCEPTION 'p_days must hold between 1 and 8 checkpoints';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_days) d WHERE d < 1 OR d > 365) THEN
    RAISE EXCEPTION 'Retention checkpoints must be between day 1 and day 365';
  END IF;

  RETURN QUERY
  WITH cohort AS MATERIALIZED (
    SELECT
      p.id,
      (p.created_at AT TIME ZONE 'UTC')::date AS cohort_date,
      p.role AS member_role
    FROM profiles p
    LEFT JOIN signup_attribution sa ON sa.user_id = p.id
    WHERE COALESCE(p.is_test_account, false) = false
      AND COALESCE(p.is_blocked, false) = false
      AND p.frozen_minor_at IS NULL
      AND (p_cohort_from IS NULL OR (p.created_at AT TIME ZONE 'UTC')::date >= p_cohort_from)
      AND (p_cohort_to   IS NULL OR (p.created_at AT TIME ZONE 'UTC')::date <= p_cohort_to)
      AND (p_role        IS NULL OR p.role = p_role)
      AND (p_country_id  IS NULL OR p.base_country_id = p_country_id)
      AND (p_platform    IS NULL OR p.last_platform = p_platform)
      AND (p_source      IS NULL OR COALESCE(NULLIF(sa.first_source, ''), 'direct') = p_source)
  ),
  -- One row per member per day they were active. Bounded to the cohort's own
  -- history so the scan never widens with the size of the tables.
  acts AS MATERIALIZED (
    SELECT DISTINCT a.user_id AS uid, a.activity_date
    FROM (
      -- 'any' — a real authenticated session, from the daily rollup.
      SELECT ued.user_id, ued.date AS activity_date
      FROM user_engagement_daily ued
      JOIN cohort c ON c.id = ued.user_id
      WHERE p_activity = 'any' AND ued.date >= c.cohort_date

      UNION ALL
      -- 'meaningful' — core actions, straight from the domain tables.
      SELECT oa.applicant_id, (oa.applied_at AT TIME ZONE 'UTC')::date
      FROM opportunity_applications oa JOIN cohort c ON c.id = oa.applicant_id
      WHERE p_activity = 'meaningful' AND (oa.applied_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT m.sender_id, (m.sent_at AT TIME ZONE 'UTC')::date
      FROM messages m JOIN cohort c ON c.id = m.sender_id
      WHERE p_activity = 'meaningful' AND m.deleted_at IS NULL
        AND (m.sent_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT f.requester_id, (f.created_at AT TIME ZONE 'UTC')::date
      FROM profile_friendships f JOIN cohort c ON c.id = f.requester_id
      WHERE p_activity = 'meaningful' AND (f.created_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT f.user_one, (f.accepted_at AT TIME ZONE 'UTC')::date
      FROM profile_friendships f JOIN cohort c ON c.id = f.user_one
      WHERE p_activity = 'meaningful' AND f.accepted_at IS NOT NULL
        AND (f.accepted_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT f.user_two, (f.accepted_at AT TIME ZONE 'UTC')::date
      FROM profile_friendships f JOIN cohort c ON c.id = f.user_two
      WHERE p_activity = 'meaningful' AND f.accepted_at IS NOT NULL
        AND (f.accepted_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT sp.owner_id, (sp.created_at AT TIME ZONE 'UTC')::date
      FROM saved_profiles sp JOIN cohort c ON c.id = sp.owner_id
      WHERE p_activity = 'meaningful' AND (sp.created_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT sl.owner_id, (sl.created_at AT TIME ZONE 'UTC')::date
      FROM shortlists sl JOIN cohort c ON c.id = sl.owner_id
      WHERE p_activity = 'meaningful' AND (sl.created_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT up.author_id, (up.created_at AT TIME ZONE 'UTC')::date
      FROM user_posts up JOIN cohort c ON c.id = up.author_id
      WHERE p_activity = 'meaningful' AND up.deleted_at IS NULL
        AND (up.created_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT pc.author_id, (pc.created_at AT TIME ZONE 'UTC')::date
      FROM post_comments pc JOIN cohort c ON c.id = pc.author_id
      WHERE p_activity = 'meaningful' AND pc.deleted_at IS NULL
        AND (pc.created_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT pr.requester_id, (pr.created_at AT TIME ZONE 'UTC')::date
      FROM profile_references pr JOIN cohort c ON c.id = pr.requester_id
      WHERE p_activity = 'meaningful' AND (pr.created_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT pr.reference_id, (pr.responded_at AT TIME ZONE 'UTC')::date
      FROM profile_references pr JOIN cohort c ON c.id = pr.reference_id
      WHERE p_activity = 'meaningful' AND pr.responded_at IS NOT NULL
        AND (pr.responded_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT de.user_id, (de.created_at AT TIME ZONE 'UTC')::date
      FROM discovery_events de JOIN cohort c ON c.id = de.user_id
      WHERE p_activity = 'meaningful' AND (de.created_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT av.viewer_id, (av.first_viewed_at AT TIME ZONE 'UTC')::date
      FROM application_views av JOIN cohort c ON c.id = av.viewer_id
      WHERE p_activity = 'meaningful' AND (av.first_viewed_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT o.club_id, (o.created_at AT TIME ZONE 'UTC')::date
      FROM opportunities o JOIN cohort c ON c.id = o.club_id
      WHERE p_activity = 'meaningful' AND (o.created_at AT TIME ZONE 'UTC')::date >= c.cohort_date
      UNION ALL
      SELECT COALESCE(e.user_id, e.resolved_user_id), (e.created_at AT TIME ZONE 'UTC')::date
      FROM events e JOIN cohort c ON c.id = COALESCE(e.user_id, e.resolved_user_id)
      WHERE p_activity = 'meaningful'
        AND e.event_name IN (
          'vacancy_view', 'opportunity_create', 'application_submit',
          'conversation_start', 'friend_request_send', 'profile_edit',
          'search', 'search_result_click'
        )
        AND (e.created_at AT TIME ZONE 'UTC')::date >= c.cohort_date
    ) a(user_id, activity_date)
    WHERE a.user_id IS NOT NULL
  )
  SELECT
    c.id,
    c.cohort_date,
    c.member_role,
    d.day_n,
    public.retention_is_eligible(c.cohort_date, d.day_n, p_method, v_today) AS eligible,
    -- Retained implies eligible, so a member is counted at most once per
    -- checkpoint and the numerator can never exceed the denominator.
    public.retention_is_eligible(c.cohort_date, d.day_n, p_method, v_today)
      AND EXISTS (
        SELECT 1 FROM acts a
        WHERE a.uid = c.id
          AND public.retention_day_matches(a.activity_date, c.cohort_date, d.day_n, p_method)
      ) AS retained
  FROM cohort c
  CROSS JOIN unnest(p_days) AS d(day_n);
END;
$$;

COMMENT ON FUNCTION public.admin_retention_facts(integer[], text, text, date, date, text, integer, text, text) IS
  'Internal: one row per member per retention checkpoint. The single source every retention report reads.';

-- Internal only. EXECUTE is granted to PUBLIC by default in Postgres, which
-- would expose it through the Data API — revoke, then let only the admin
-- wrappers (SECURITY DEFINER, owned by postgres) call it.
REVOKE ALL ON FUNCTION public.admin_retention_facts(integer[], text, text, date, date, text, integer, text, text) FROM PUBLIC, anon, authenticated;

-- ── 3. Summary cards (Overview) ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_retention_summary(
  p_days        integer[] DEFAULT ARRAY[7, 15, 30],
  p_activity    text      DEFAULT 'any',
  p_method      text      DEFAULT 'bracket',
  p_period_days integer   DEFAULT 90,
  p_role        text      DEFAULT NULL,
  p_country_id  integer   DEFAULT NULL,
  p_platform    text      DEFAULT NULL,
  p_source      text      DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'UTC')::date;
  v_cur_from  date;
  v_prev_from date;
  v_prev_to   date;
  v_result    jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  IF p_period_days IS NULL OR p_period_days < 7 OR p_period_days > 730 THEN
    RAISE EXCEPTION 'p_period_days must be between 7 and 730';
  END IF;

  v_cur_from  := v_today - p_period_days;
  v_prev_to   := v_cur_from - 1;
  v_prev_from := v_prev_to - p_period_days;

  WITH cur AS (
    SELECT * FROM public.admin_retention_facts(
      p_days, p_activity, p_method, v_cur_from, v_today,
      p_role, p_country_id, p_platform, p_source)
  ),
  prev AS (
    SELECT * FROM public.admin_retention_facts(
      p_days, p_activity, p_method, v_prev_from, v_prev_to,
      p_role, p_country_id, p_platform, p_source)
  ),
  cur_agg AS (
    SELECT
      day_n,
      COUNT(*)::int                                        AS cohort_size,
      COUNT(*) FILTER (WHERE eligible)::int                 AS eligible,
      COUNT(*) FILTER (WHERE retained)::int                 AS retained
    FROM cur GROUP BY day_n
  ),
  prev_agg AS (
    SELECT
      day_n,
      COUNT(*) FILTER (WHERE eligible)::int                 AS eligible,
      COUNT(*) FILTER (WHERE retained)::int                 AS retained
    FROM prev GROUP BY day_n
  )
  SELECT jsonb_build_object(
    'method',        p_method,
    'activity',      p_activity,
    'timezone',      'UTC',
    'period_days',   p_period_days,
    'cohort_from',   v_cur_from,
    'cohort_to',     v_today,
    'generated_at',  now(),
    'checkpoints',   COALESCE(jsonb_agg(chk ORDER BY (chk->>'day')::int), '[]'::jsonb)
  )
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'day',            c.day_n,
      'cohort_size',    c.cohort_size,
      'eligible',       c.eligible,
      'retained',       c.retained,
      'pct',            CASE WHEN c.eligible > 0
                          THEN ROUND(c.retained::numeric / c.eligible * 100, 1) END,
      'prev_eligible',  COALESCE(p.eligible, 0),
      'prev_retained',  COALESCE(p.retained, 0),
      'prev_pct',       CASE WHEN COALESCE(p.eligible, 0) > 0
                          THEN ROUND(p.retained::numeric / p.eligible * 100, 1) END,
      'delta_pts',      CASE WHEN c.eligible > 0 AND COALESCE(p.eligible, 0) > 0
                          THEN ROUND(c.retained::numeric / c.eligible * 100
                                   - p.retained::numeric / p.eligible * 100, 1) END
    ) AS chk
    FROM cur_agg c
    LEFT JOIN prev_agg p ON p.day_n = c.day_n
  ) s;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_get_retention_summary(integer[], text, text, integer, text, integer, text, text) IS
  'D7/D15/D30 summary: percentage, retained, eligible denominator and the change vs the preceding equal-length signup period. NULL pct when nothing is eligible yet.';

GRANT EXECUTE ON FUNCTION public.admin_get_retention_summary(integer[], text, text, integer, text, integer, text, text) TO authenticated;

-- ── 4. Cohort table / heatmap (Retention tab) ───────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_retention_cohort_table(
  p_days        integer[] DEFAULT ARRAY[7, 15, 30],
  p_activity    text      DEFAULT 'any',
  p_method      text      DEFAULT 'bracket',
  p_grain       text      DEFAULT 'week',
  p_cohort_from date      DEFAULT NULL,
  p_cohort_to   date      DEFAULT NULL,
  p_role        text      DEFAULT NULL,
  p_country_id  integer   DEFAULT NULL,
  p_platform    text      DEFAULT NULL,
  p_source      text      DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_from  date;
  v_to    date;
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;
  IF p_grain NOT IN ('week', 'month') THEN
    RAISE EXCEPTION 'p_grain must be week or month';
  END IF;

  v_to   := COALESCE(p_cohort_to, v_today);
  v_from := COALESCE(p_cohort_from, v_to - 180);

  WITH facts AS (
    SELECT * FROM public.admin_retention_facts(
      p_days, p_activity, p_method, v_from, v_to,
      p_role, p_country_id, p_platform, p_source)
  ),
  binned AS (
    SELECT
      CASE WHEN p_grain = 'month'
        THEN date_trunc('month', cohort_date)::date
        ELSE date_trunc('week',  cohort_date)::date
      END AS cohort_start,
      day_n, user_id, eligible, retained
    FROM facts
  ),
  cells AS (
    SELECT
      cohort_start,
      day_n,
      COUNT(DISTINCT user_id)::int                                    AS cohort_size,
      COUNT(DISTINCT user_id) FILTER (WHERE eligible)::int             AS eligible,
      COUNT(DISTINCT user_id) FILTER (WHERE retained)::int             AS retained
    FROM binned
    GROUP BY cohort_start, day_n
  ),
  rows_agg AS (
    SELECT
      cohort_start,
      MAX(cohort_size) AS cohort_size,
      jsonb_agg(
        jsonb_build_object(
          'day',      day_n,
          'eligible', eligible,
          'retained', retained,
          'pct',      CASE WHEN eligible > 0
                        THEN ROUND(retained::numeric / eligible * 100, 1) END
        ) ORDER BY day_n
      ) AS cells
    FROM cells
    GROUP BY cohort_start
  )
  SELECT jsonb_build_object(
    'method',       p_method,
    'activity',     p_activity,
    'grain',        p_grain,
    'timezone',     'UTC',
    'cohort_from',  v_from,
    'cohort_to',    v_to,
    'days',         to_jsonb(p_days),
    'generated_at', now(),
    'rows',         COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'cohort_start', cohort_start,
         'cohort_size',  cohort_size,
         'cells',        cells
       ) ORDER BY cohort_start DESC) FROM rows_agg),
      '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_get_retention_cohort_table(integer[], text, text, text, date, date, text, integer, text, text) IS
  'Cohort-by-checkpoint retention grid. Same facts function as the summary cards, so identical filters always yield identical numbers.';

GRANT EXECUTE ON FUNCTION public.admin_get_retention_cohort_table(integer[], text, text, text, date, date, text, integer, text, text) TO authenticated;

-- ── 5. Filter options (populate the dropdowns from real data) ───────────

CREATE OR REPLACE FUNCTION public.admin_get_retention_filter_options()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT jsonb_build_object(
    'roles', COALESCE((
      SELECT jsonb_agg(DISTINCT p.role ORDER BY p.role)
      FROM profiles p
      WHERE COALESCE(p.is_test_account, false) = false AND p.role IS NOT NULL
    ), '[]'::jsonb),
    'countries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name)
      FROM (
        SELECT DISTINCT co.id, co.name
        FROM profiles p
        JOIN countries co ON co.id = p.base_country_id
        WHERE COALESCE(p.is_test_account, false) = false
      ) x
    ), '[]'::jsonb),
    'platforms', COALESCE((
      SELECT jsonb_agg(DISTINCT p.last_platform ORDER BY p.last_platform)
      FROM profiles p
      WHERE COALESCE(p.is_test_account, false) = false AND p.last_platform IS NOT NULL
    ), '[]'::jsonb),
    'sources', COALESCE((
      SELECT jsonb_agg(DISTINCT COALESCE(NULLIF(sa.first_source, ''), 'direct') ORDER BY COALESCE(NULLIF(sa.first_source, ''), 'direct'))
      FROM signup_attribution sa
      JOIN profiles p ON p.id = sa.user_id
      WHERE COALESCE(p.is_test_account, false) = false
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_retention_filter_options() TO authenticated;

-- ── 6. Indexes the facts query leans on ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_engagement_daily_user_date
  ON public.user_engagement_daily (user_id, date);
CREATE INDEX IF NOT EXISTS idx_profiles_created_at_utc
  ON public.profiles (created_at);
