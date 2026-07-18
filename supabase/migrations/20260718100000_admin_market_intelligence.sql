-- Admin Market Intelligence — aggregates RPC (Opportunities → Market tab, Phase 1)
-- ============================================================================
-- One server-side round trip powering the founder's market-intelligence layer:
-- health strip, position×gender balance matrix, both recruitment funnels, and
-- the per-club behavior table. The client's rules engine ("next best actions")
-- consumes this payload — rules live in TypeScript so copy/thresholds iterate
-- without migrations.
--
-- Design notes:
-- - Admin-only: is_platform_admin() guard + EXECUTE revoked from anon/PUBLIC.
--   Hidden-profile fencing is intentionally NOT applied — this is an admin
--   surface; admins see everything (standing-invariant exemption).
-- - Test accounts (profiles.is_test_account) are excluded everywhere: their
--   vacancies, applications, views, and supply would distort a 24-vacancy
--   market badly.
-- - Small-N honesty: medians not means; mostly all-time windows; the demand
--   window for the matrix defaults to 90 days (p_demand_days).
-- - "Actioned" application = status other than pending/withdrawn (withdrawn is
--   player-initiated, so it counts in neither numerator nor denominator of
--   club response rate).
-- - median_response_days approximates response lag as updated_at − applied_at
--   on actioned rows; later status flips overwrite updated_at, acceptable at
--   this scale.
-- - "Active supply" = open_to_play + profile touched within 60 days; stale
--   supply is reported separately (re-engagement target, not inventory).
-- - Vacancy gender 'Men'/'Women' maps to playing_category groups
--   (adult_men+boys / adult_women+girls) for the supply side of the matrix.
-- - head_coach openings are demand for coaches, not players — reported as a
--   separate line, kept out of the player matrix.

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
  v_demand_cutoff timestamptz;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  v_demand_cutoff := timezone('utc', now()) - make_interval(days => p_demand_days);

  WITH real_opps AS (
    SELECT o.*
    FROM opportunities o
    JOIN profiles cp ON cp.id = o.club_id
    WHERE cp.is_test_account = false
  ),
  real_apps AS (
    SELECT a.*, o.position AS opp_position, o.gender AS opp_gender,
           o.published_at AS opp_published_at, o.club_id AS opp_club_id
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
  -- ── Health strip ─────────────────────────────────────────────────────────
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
  -- ── Balance matrix: player positions × Men/Women ─────────────────────────
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
  -- ── Funnels ──────────────────────────────────────────────────────────────
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
  -- ── Club behavior table ──────────────────────────────────────────────────
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
  -- ── Country splits ───────────────────────────────────────────────────────
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
    'supply_by_country', (SELECT j FROM supply_by_country)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_market_intelligence(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_market_intelligence(INT) TO authenticated, service_role;

-- Self-check: non-admin execution must be refused; shape must materialize.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_market_intelligence(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon holds EXECUTE on admin_market_intelligence';
  END IF;
END $$;