-- Market Intelligence Phase 3 — weekly admin market digest (the market
-- reports to you)
-- ============================================================================
-- Chain (house email pattern, same as the Monday recap / age-gate emails):
--   pg_cron (Mon 09:00 UTC) → enqueue_admin_market_digest() → INSERT into
--   admin_digest_queue (payload = the full admin_market_intelligence snapshot,
--   computed at ENQUEUE time so the email always matches one snapshot) →
--   dashboard-configured database webhook → edge fn admin-market-digest →
--   rules engine + HTML → Resend to the admin address.
--
-- NOTE: the AFTER INSERT webhook on admin_digest_queue is created in the
-- Supabase dashboard (it embeds the per-project service key, which must not
-- live in a committed migration) — one-time step per environment, same as
-- every existing notify-* webhook.

-- ── 1. Guard extension: let the cron context compute the snapshot ──────────
-- admin_market_intelligence refuses non-admins by JWT claim. A pg_cron / psql
-- session has NO request.jwt.claims at all — a state no PostgREST/API caller
-- can ever be in (the API always stamps claims; anon comes through with
-- role=anon and is still refused). Allowing the claims-less context lets the
-- enqueue function snapshot the payload without weakening API-facing security.

CREATE OR REPLACE FUNCTION public.admin_market_intelligence(
  p_demand_days INT DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (
    public.is_platform_admin()
    OR COALESCE(current_setting('request.jwt.claims', true), '') = ''
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT public.admin_market_intelligence_impl(p_demand_days) INTO v_result;
  RETURN v_result;
END;
$function$;

-- The Phase 2 aggregates move verbatim into an UNGRANTED internal impl so the
-- guard wrapper stays tiny and the aggregates stay single-sourced (body is a
-- literal copy of 20260718120000 minus the guard; future aggregate changes
-- edit ONLY the impl).
CREATE OR REPLACE FUNCTION public.admin_market_intelligence_impl(
  p_demand_days INT DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_demand_cutoff timestamptz;
BEGIN
  v_demand_cutoff := timezone('utc', now()) - make_interval(days => p_demand_days);

  WITH real_opps AS (
    SELECT o.*
    FROM opportunities o
    JOIN profiles cp ON cp.id = o.club_id
    WHERE cp.is_test_account = false
  ),
  real_apps AS (
    SELECT a.*, o.position AS opp_position, o.gender AS opp_gender,
           o.published_at AS opp_published_at, o.club_id AS opp_club_id,
           o.location_country AS opp_country
    FROM opportunity_applications a
    JOIN real_opps o ON o.id = a.opportunity_id
    JOIN profiles ap ON ap.id = a.applicant_id
    WHERE ap.is_test_account = false
  ),
  supply AS (
    SELECT p.id, p.position, p.playing_category,
           (p.updated_at >= timezone('utc', now()) - interval '60 days') AS is_active
    FROM profiles p
    WHERE p.role = 'player'
      AND p.open_to_play = true
      AND p.is_test_account = false
  ),
  apps_per_vacancy AS (
    SELECT o.id, count(a.id) AS app_count
    FROM real_opps o
    LEFT JOIN real_apps a ON a.opportunity_id = o.id
    WHERE o.published_at IS NOT NULL
    GROUP BY o.id
  ),
  health AS (
    SELECT jsonb_build_object(
      'open_vacancies', (SELECT count(*) FROM real_opps WHERE status = 'open'),
      'active_supply', (SELECT count(*) FROM supply WHERE is_active),
      'stale_supply', (SELECT count(*) FROM supply WHERE NOT is_active),
      'median_apps_per_vacancy',
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY app_count) FROM apps_per_vacancy),
      'cold_vacancies',
        (SELECT count(*) FROM real_opps o
         WHERE o.status = 'open'
           AND o.published_at < timezone('utc', now()) - interval '14 days'
           AND NOT EXISTS (SELECT 1 FROM real_apps a WHERE a.opportunity_id = o.id)),
      'open_over_14d',
        (SELECT count(*) FROM real_opps
         WHERE status = 'open'
           AND published_at < timezone('utc', now()) - interval '14 days'),
      'total_apps', (SELECT count(*) FROM real_apps WHERE status <> 'withdrawn'),
      'responded_apps', (SELECT count(*) FROM real_apps WHERE status NOT IN ('pending','withdrawn')),
      'pending_apps', (SELECT count(*) FROM real_apps WHERE status = 'pending'),
      'filled_via_hockia', (SELECT count(*) FROM real_opps WHERE filled_via_hockia = true),
      'closed_vacancies', (SELECT count(*) FROM real_opps WHERE status = 'closed'),
      'median_hours_to_first_app',
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY first_lag)
         FROM (SELECT extract(epoch FROM min(a.applied_at) - o.published_at) / 3600.0 AS first_lag
               FROM real_opps o
               JOIN real_apps a ON a.opportunity_id = o.id
               WHERE o.published_at IS NOT NULL
               GROUP BY o.id, o.published_at) t),
      'median_days_to_fill',
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY fill_lag)
         FROM (SELECT extract(epoch FROM closed_at - published_at) / 86400.0 AS fill_lag
               FROM real_opps
               WHERE filled_via_hockia = true
                 AND closed_at IS NOT NULL AND published_at IS NOT NULL) t)
    ) AS j
  ),
  matrix AS (
    SELECT jsonb_agg(jsonb_build_object(
      'position', cell.position,
      'gender', cell.gender,
      'demand_window', COALESCE(d.demand_window, 0),
      'demand_open_now', COALESCE(d.demand_open_now, 0),
      'supply_active', COALESCE(s.supply_active, 0),
      'supply_stale', COALESCE(s.supply_stale, 0),
      'apps_window', COALESCE(ap.apps_window, 0)
    ) ORDER BY cell.gender, cell.position) AS j
    FROM (SELECT p.position, g.gender
          FROM unnest(ARRAY['goalkeeper','defender','midfielder','forward']) AS p(position)
          CROSS JOIN unnest(ARRAY['Men','Women']) AS g(gender)) cell
    LEFT JOIN (
      SELECT position::text AS position, gender::text AS gender,
             count(*) FILTER (WHERE published_at >= v_demand_cutoff) AS demand_window,
             count(*) FILTER (WHERE status = 'open') AS demand_open_now
      FROM real_opps
      WHERE position::text <> 'head_coach'
      GROUP BY 1, 2
    ) d ON d.position = cell.position AND d.gender = cell.gender
    LEFT JOIN (
      SELECT position,
             CASE WHEN playing_category IN ('adult_men','boys') THEN 'Men' ELSE 'Women' END AS gender,
             count(*) FILTER (WHERE is_active) AS supply_active,
             count(*) FILTER (WHERE NOT is_active) AS supply_stale
      FROM supply
      WHERE position IS NOT NULL AND playing_category IS NOT NULL
      GROUP BY 1, 2
    ) s ON s.position = cell.position AND s.gender = cell.gender
    LEFT JOIN (
      SELECT opp_position::text AS position, opp_gender::text AS gender,
             count(*) AS apps_window
      FROM real_apps
      WHERE applied_at >= v_demand_cutoff AND status <> 'withdrawn'
      GROUP BY 1, 2
    ) ap ON ap.position = cell.position AND ap.gender = cell.gender
  ),
  coach_demand AS (
    SELECT jsonb_build_object(
      'open_now', count(*) FILTER (WHERE status = 'open'),
      'demand_window', count(*) FILTER (WHERE published_at >= v_demand_cutoff)
    ) AS j
    FROM real_opps WHERE position::text = 'head_coach'
  ),
  vacancy_funnel AS (
    SELECT jsonb_build_object(
      'published', count(*),
      'viewed', count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM events e WHERE e.event_name = 'vacancy_view' AND e.entity_id = o.id)),
      'applied', count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM real_apps a WHERE a.opportunity_id = o.id)),
      'responded', count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM real_apps a WHERE a.opportunity_id = o.id
          AND a.status NOT IN ('pending','withdrawn'))),
      'filled', count(*) FILTER (WHERE o.filled_via_hockia = true)
    ) AS j
    FROM real_opps o
    WHERE o.published_at IS NOT NULL
  ),
  player_funnel AS (
    SELECT jsonb_build_object(
      'players', (SELECT count(*) FROM profiles WHERE role = 'player' AND is_test_account = false),
      'completed_profile', (SELECT count(*) FROM profiles
                            WHERE role = 'player' AND is_test_account = false
                              AND onboarding_completed = true),
      'open_to_play', (SELECT count(*) FROM supply),
      'viewed_vacancy', (SELECT count(DISTINCT e.user_id) FROM events e
                         JOIN profiles p ON p.id = e.user_id
                         WHERE e.event_name = 'vacancy_view'
                           AND p.role = 'player' AND p.is_test_account = false),
      'applied', (SELECT count(DISTINCT applicant_id) FROM real_apps),
      'got_response', (SELECT count(DISTINCT applicant_id) FROM real_apps
                       WHERE status NOT IN ('pending','withdrawn')),
      'advanced', (SELECT count(DISTINCT applicant_id) FROM real_apps
                   WHERE status IN ('shortlisted','maybe'))
    ) AS j
  ),
  clubs AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'club_profile_id', c.club_id,
      'club_name', c.club_name,
      'posted', c.posted,
      'open_now', c.open_now,
      'apps_received', c.apps_received,
      'responded', c.responded,
      'pending_backlog', c.pending_backlog,
      'oldest_pending_days', c.oldest_pending_days,
      'filled', c.filled,
      'median_response_days', c.median_response_days
    ) ORDER BY c.posted DESC, c.apps_received DESC), '[]'::jsonb) AS j
    FROM (
      SELECT o.club_id,
             COALESCE(max(cp.full_name), max(o.organization_name)) AS club_name,
             count(DISTINCT o.id) AS posted,
             count(DISTINCT o.id) FILTER (WHERE o.status = 'open') AS open_now,
             count(a.id) FILTER (WHERE a.status <> 'withdrawn') AS apps_received,
             count(a.id) FILTER (WHERE a.status NOT IN ('pending','withdrawn')) AS responded,
             count(a.id) FILTER (WHERE a.status = 'pending') AS pending_backlog,
             floor(extract(epoch FROM timezone('utc', now()) - min(a.applied_at)
                   FILTER (WHERE a.status = 'pending')) / 86400.0) AS oldest_pending_days,
             count(DISTINCT o.id) FILTER (WHERE o.filled_via_hockia = true) AS filled,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY
               extract(epoch FROM a.updated_at - a.applied_at) / 86400.0)
               FILTER (WHERE a.status NOT IN ('pending','withdrawn')) AS median_response_days
      FROM real_opps o
      JOIN profiles cp ON cp.id = o.club_id
      LEFT JOIN real_apps a ON a.opportunity_id = o.id
      GROUP BY o.club_id
    ) c
  ),
  demand_by_country AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'country', location_country, 'vacancies', cnt, 'open_now', open_cnt
    ) ORDER BY cnt DESC), '[]'::jsonb) AS j
    FROM (SELECT location_country, count(*) AS cnt,
                 count(*) FILTER (WHERE status = 'open') AS open_cnt
          FROM real_opps
          WHERE location_country IS NOT NULL
          GROUP BY location_country) t
  ),
  supply_by_country AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'country', country, 'players', cnt, 'active', active_cnt
    ) ORDER BY cnt DESC), '[]'::jsonb) AS j
    FROM (SELECT p.base_location AS country, count(*) AS cnt,
                 count(*) FILTER (WHERE s.is_active) AS active_cnt
          FROM supply s
          JOIN profiles p ON p.id = s.id
          WHERE p.base_location IS NOT NULL
          GROUP BY p.base_location
          ORDER BY count(*) DESC
          LIMIT 15) t
  ),
  corridors AS (
    SELECT jsonb_build_object(
      'flows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'from_country', t.from_country,
          'to_country', t.to_country,
          'applications', t.cnt
        ) ORDER BY t.cnt DESC)
        FROM (
          SELECT c.name AS from_country, a.opp_country AS to_country, count(*) AS cnt
          FROM real_apps a
          JOIN profiles ap ON ap.id = a.applicant_id
          JOIN countries c ON c.id = ap.nationality_country_id
          WHERE a.status <> 'withdrawn' AND a.opp_country IS NOT NULL
          GROUP BY c.name, a.opp_country
          ORDER BY count(*) DESC
          LIMIT 10
        ) t), '[]'::jsonb),
      'unknown_origin', (
        SELECT count(*) FROM real_apps a
        JOIN profiles ap ON ap.id = a.applicant_id
        WHERE a.status <> 'withdrawn' AND ap.nationality_country_id IS NULL)
    ) AS j
  ),
  open_quality AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'title', q.title,
      'club_name', q.club_name,
      'days_open', q.days_open,
      'app_count', q.app_count,
      'score', q.score,
      'missing', q.missing
    ) ORDER BY q.score ASC, q.days_open DESC), '[]'::jsonb) AS j
    FROM (
      SELECT o.id, o.title,
             COALESCE(cp.full_name, o.organization_name) AS club_name,
             floor(extract(epoch FROM timezone('utc', now()) - o.published_at) / 86400.0) AS days_open,
             (SELECT count(*) FROM real_apps a
              WHERE a.opportunity_id = o.id AND a.status <> 'withdrawn') AS app_count,
             (( (o.compensation IS NOT NULL AND o.compensation <> '')::int
              + (EXISTS (SELECT 1 FROM unnest(o.benefits || o.custom_benefits) b
                         WHERE lower(b) LIKE '%hous%'))::int
              + (EXISTS (SELECT 1 FROM unnest(o.benefits || o.custom_benefits) b
                         WHERE lower(b) LIKE '%flight%'))::int
              + (length(COALESCE(o.description, '')) >= 300)::int
              + (o.start_date IS NOT NULL)::int
              + (o.level_sought IS NOT NULL AND o.level_sought <> '')::int
              + (cp.avatar_url IS NOT NULL)::int
              + (o.application_deadline IS NOT NULL)::int
             ) * 100 / 8) AS score,
             (SELECT COALESCE(jsonb_agg(m.attr), '[]'::jsonb) FROM (
                SELECT 'compensation' AS attr WHERE o.compensation IS NULL OR o.compensation = ''
                UNION ALL SELECT 'housing' WHERE NOT EXISTS (
                  SELECT 1 FROM unnest(o.benefits || o.custom_benefits) b WHERE lower(b) LIKE '%hous%')
                UNION ALL SELECT 'flights' WHERE NOT EXISTS (
                  SELECT 1 FROM unnest(o.benefits || o.custom_benefits) b WHERE lower(b) LIKE '%flight%')
                UNION ALL SELECT 'description' WHERE length(COALESCE(o.description, '')) < 300
                UNION ALL SELECT 'start_date' WHERE o.start_date IS NULL
                UNION ALL SELECT 'level' WHERE o.level_sought IS NULL OR o.level_sought = ''
                UNION ALL SELECT 'club_logo' WHERE cp.avatar_url IS NULL
                UNION ALL SELECT 'deadline' WHERE o.application_deadline IS NULL
             ) m) AS missing
      FROM real_opps o
      JOIN profiles cp ON cp.id = o.club_id
      WHERE o.status = 'open' AND o.published_at IS NOT NULL
    ) q
  ),
  top_vacancies AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'club_name', t.club_name,
      'applications', t.apps, 'status', t.status
    ) ORDER BY t.apps DESC), '[]'::jsonb) AS j
    FROM (
      SELECT o.id, o.title, COALESCE(cp.full_name, o.organization_name) AS club_name,
             o.status,
             count(a.id) FILTER (WHERE a.status <> 'withdrawn') AS apps
      FROM real_opps o
      JOIN profiles cp ON cp.id = o.club_id
      LEFT JOIN real_apps a ON a.opportunity_id = o.id
      WHERE o.published_at IS NOT NULL
      GROUP BY o.id, o.title, cp.full_name, o.organization_name, o.status
      HAVING count(a.id) FILTER (WHERE a.status <> 'withdrawn') > 0
      ORDER BY apps DESC
      LIMIT 5
    ) t
  ),
  trends AS (
    SELECT jsonb_agg(jsonb_build_object(
      'month', to_char(m.month, 'YYYY-MM'),
      'posted', COALESCE(p.cnt, 0),
      'applications', COALESCE(a.cnt, 0),
      'filled', COALESCE(f.cnt, 0)
    ) ORDER BY m.month) AS j
    FROM (SELECT generate_series(
            date_trunc('month', timezone('utc', now())) - interval '5 months',
            date_trunc('month', timezone('utc', now())),
            interval '1 month') AS month) m
    LEFT JOIN (SELECT date_trunc('month', published_at) AS month, count(*) AS cnt
               FROM real_opps WHERE published_at IS NOT NULL GROUP BY 1) p ON p.month = m.month
    LEFT JOIN (SELECT date_trunc('month', applied_at) AS month, count(*) AS cnt
               FROM real_apps WHERE status <> 'withdrawn' GROUP BY 1) a ON a.month = m.month
    LEFT JOIN (SELECT date_trunc('month', closed_at) AS month, count(*) AS cnt
               FROM real_opps WHERE filled_via_hockia = true AND closed_at IS NOT NULL
               GROUP BY 1) f ON f.month = m.month
  ),
  per_applicant AS (
    SELECT a.applicant_id,
           count(*) FILTER (WHERE a.status <> 'withdrawn') AS apps,
           bool_or(a.status NOT IN ('pending','withdrawn')) AS ever_responded,
           max(a.applied_at) AS last_applied_at,
           min(a.applied_at) AS first_applied_at
    FROM real_apps a
    GROUP BY a.applicant_id
  ),
  player_behavior AS (
    SELECT jsonb_build_object(
      'applicants', (SELECT count(*) FROM per_applicant WHERE apps > 0),
      'median_apps_per_applicant',
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY apps)
         FROM per_applicant WHERE apps > 0),
      'multi_appliers', (SELECT count(*) FROM per_applicant WHERE apps >= 2),
      'median_days_signup_to_first_app',
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY lag_days)
         FROM (SELECT extract(epoch FROM pa.first_applied_at - p.created_at) / 86400.0 AS lag_days
               FROM per_applicant pa JOIN profiles p ON p.id = pa.applicant_id) t),
      'silent_supply', jsonb_build_object(
        'count', (SELECT count(*) FROM supply s WHERE s.is_active
                  AND NOT EXISTS (SELECT 1 FROM opportunity_applications a
                                  WHERE a.applicant_id = s.id)),
        'players', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name))
          FROM (SELECT p2.id, p2.full_name
                FROM supply s JOIN profiles p2 ON p2.id = s.id
                WHERE s.is_active
                  AND NOT EXISTS (SELECT 1 FROM opportunity_applications a
                                  WHERE a.applicant_id = s.id)
                ORDER BY p2.updated_at DESC
                LIMIT 8) p), '[]'::jsonb)),
      'burned', jsonb_build_object(
        'count', (SELECT count(*) FROM per_applicant pa
                  WHERE pa.apps > 0 AND NOT pa.ever_responded
                    AND pa.last_applied_at < timezone('utc', now()) - interval '7 days'),
        'players', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.full_name, 'applications', pa.apps,
            'days_since_last_app',
              floor(extract(epoch FROM timezone('utc', now()) - pa.last_applied_at) / 86400.0)))
          FROM (SELECT * FROM per_applicant pa2
                WHERE pa2.apps > 0 AND NOT pa2.ever_responded
                  AND pa2.last_applied_at < timezone('utc', now()) - interval '7 days'
                ORDER BY pa2.apps DESC, pa2.last_applied_at ASC
                LIMIT 8) pa
          JOIN profiles p ON p.id = pa.applicant_id), '[]'::jsonb))
    ) AS j
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'computed_at', timezone('utc', now()),
      'demand_window_days', p_demand_days,
      'test_accounts_excluded', true
    ),
    'health', (SELECT j FROM health),
    'matrix', (SELECT j FROM matrix),
    'coach_demand', (SELECT j FROM coach_demand),
    'vacancy_funnel', (SELECT j FROM vacancy_funnel),
    'player_funnel', (SELECT j FROM player_funnel),
    'clubs', (SELECT j FROM clubs),
    'demand_by_country', (SELECT j FROM demand_by_country),
    'supply_by_country', (SELECT j FROM supply_by_country),
    'corridors', (SELECT j FROM corridors),
    'open_vacancy_quality', (SELECT j FROM open_quality),
    'top_vacancies', (SELECT j FROM top_vacancies),
    'trends', (SELECT j FROM trends),
    'player_behavior', (SELECT j FROM player_behavior)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- The impl is internal: nothing but the wrapper (and superuser contexts) may
-- execute it directly.
REVOKE ALL ON FUNCTION public.admin_market_intelligence_impl(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_market_intelligence_impl(INT) TO service_role;

REVOKE ALL ON FUNCTION public.admin_market_intelligence(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_market_intelligence(INT) TO authenticated, service_role;

-- ── 2. Digest queue (service-role/webhook plumbing only) ───────────────────

CREATE TABLE IF NOT EXISTS public.admin_digest_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  sent_at TIMESTAMPTZ,
  error TEXT
);

ALTER TABLE public.admin_digest_queue ENABLE ROW LEVEL SECURITY;
-- Internal plumbing: no client access at all (CLAUDE.md service-role-only
-- table rule — the default privileges would otherwise grant CRUD).
REVOKE ALL ON TABLE public.admin_digest_queue FROM anon, authenticated;

COMMENT ON TABLE public.admin_digest_queue IS
  'Weekly admin market-digest queue. INSERT (via enqueue_admin_market_digest cron) fires the dashboard-configured webhook to the admin-market-digest edge fn.';

-- ── 3. Recipient setting + enqueue function ────────────────────────────────

INSERT INTO public.app_settings (key, value)
VALUES ('admin_digest_email', 'tianurien@gmail.com')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enqueue_admin_market_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_recipient text;
BEGIN
  -- Cron (claims-less) or an admin may enqueue; nothing else.
  IF NOT (
    public.is_platform_admin()
    OR COALESCE(current_setting('request.jwt.claims', true), '') = ''
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Cooldown guard (cron-jitter class: cooldown must be < cadence — 5 days
  -- for a weekly job, so a retried/rescheduled run cannot double-send but a
  -- normal next week always passes).
  IF EXISTS (
    SELECT 1 FROM admin_digest_queue
    WHERE created_at > timezone('utc', now()) - interval '5 days'
  ) THEN
    RAISE NOTICE 'admin market digest: skipped (sent within cooldown)';
    RETURN;
  END IF;

  SELECT value INTO v_recipient FROM app_settings WHERE key = 'admin_digest_email';
  IF v_recipient IS NULL OR v_recipient = '' THEN
    RAISE NOTICE 'admin market digest: no recipient configured';
    RETURN;
  END IF;

  INSERT INTO admin_digest_queue (recipient, payload)
  VALUES (v_recipient, public.admin_market_intelligence_impl(90));
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_admin_market_digest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_admin_market_digest() TO authenticated, service_role;

-- ── 4. Weekly cron: Monday 09:00 UTC (06:00 in Buenos Aires) ───────────────

DO $$
BEGIN
  PERFORM cron.unschedule('admin_market_digest')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin_market_digest');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'admin_market_digest',
    '0 9 * * 1',
    'SELECT public.enqueue_admin_market_digest();'
  );
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Skipping cron scheduling: insufficient privileges — schedule admin_market_digest in the dashboard';
END $$;

-- ── 5. Self-checks ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_market_intelligence_impl(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon holds EXECUTE on admin_market_intelligence_impl';
  END IF;
  IF has_function_privilege('authenticated', 'public.admin_market_intelligence_impl(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated holds EXECUTE on admin_market_intelligence_impl';
  END IF;
  IF has_function_privilege('anon', 'public.admin_market_intelligence(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon holds EXECUTE on admin_market_intelligence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'admin_digest_email') THEN
    RAISE EXCEPTION 'admin_digest_email setting missing';
  END IF;
END $$;