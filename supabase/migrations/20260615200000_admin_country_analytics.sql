-- ─────────────────────────────────────────────────────────────────────
-- Admin Portal — Countries / Nationalities analytics.
--
-- Answers: which countries are represented, % of users/players/coaches per
-- country, dual-nationality count, EU eligibility (overall + per role), and
-- how much nationality data is missing.
--
-- Methodology (founder-chosen):
--  • Per-country table COUNTS EVERY NATIONALITY: a dual AR+IT user is counted
--    under both Argentina and Italy, so country %s can exceed 100% (the UI
--    disclaims this). Each user is still counted at most once PER country
--    (DISTINCT), so a country's own count is honest.
--  • EU eligibility is a per-USER boolean (either nationality ∈ EU-27), so EU
--    %s are NOT double-counted and stay ≤ 100%. Per founder decision EU is
--    computed for ALL roles — for clubs/brands their single country acts as
--    the "based in EU" signal (they have no second nationality).
--  • The continent donut uses each user's PRIMARY nationality (COALESCE of the
--    two FKs) so it's a clean partition that sums to the with-nationality base.
--
-- EU-27 is inlined here (no eu column on countries; the three runtimes —
-- browser TS, plpgsql, Deno — can't share a literal). Mirrors the canonical
-- EU_COUNTRY_CODES in client/src/hooks/useCountries.ts; keep them in sync.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_country_analytics(
  p_filters JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role            TEXT    := NULLIF(p_filters ->> 'role', '');
  v_country_id      INT     := NULLIF(p_filters ->> 'country_id', '')::INT;
  v_active          BOOLEAN := COALESCE((p_filters ->> 'active')::BOOLEAN, false);
  v_min_completeness NUMERIC := NULLIF(p_filters ->> 'min_completeness', '')::NUMERIC;
  v_open_to_play    BOOLEAN := COALESCE((p_filters ->> 'open_to_play')::BOOLEAN, false);
  v_open_to_coach   BOOLEAN := COALESCE((p_filters ->> 'open_to_coach')::BOOLEAN, false);
  v_result JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  WITH eu AS (
    -- EU-27 (mirror of EU_COUNTRY_CODES in useCountries.ts)
    SELECT id FROM countries WHERE upper(code) IN (
      'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
      'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
    )
  ),
  base_users AS (
    SELECT
      p.id,
      p.role::TEXT AS role,
      p.nationality_country_id AS nat1,
      p.nationality2_country_id AS nat2
    FROM profiles p
    WHERE NOT p.is_test_account
      AND (v_role IS NULL OR p.role::TEXT = v_role)
      AND (v_country_id IS NULL
           OR p.nationality_country_id = v_country_id
           OR p.nationality2_country_id = v_country_id)
      AND (NOT v_active OR EXISTS (
            SELECT 1 FROM user_engagement_daily ued
            WHERE ued.user_id = p.id AND ued.date > CURRENT_DATE - 30))
      AND (v_min_completeness IS NULL OR p.profile_completeness_pct >= v_min_completeness)
      AND (NOT v_open_to_play OR p.open_to_play = true)
      AND (NOT v_open_to_coach OR p.open_to_coach = true)
  ),
  users AS (
    SELECT
      bu.*,
      (bu.nat1 IN (SELECT id FROM eu) OR bu.nat2 IN (SELECT id FROM eu)) AS is_eu,
      (bu.nat1 IS NULL AND bu.nat2 IS NULL) AS missing_nat,
      -- Genuinely dual = two DISTINCT nationalities (a row with the same
      -- country in both slots is not dual).
      (bu.nat1 IS NOT NULL AND bu.nat2 IS NOT NULL AND bu.nat1 <> bu.nat2) AS is_dual,
      COALESCE(bu.nat1, bu.nat2) AS primary_nat
    FROM base_users bu
  ),
  -- One row per (user, distinct nationality) — the "count every nationality"
  -- unpivot. A dual user yields two rows; same-country-twice yields one.
  nat_pairs AS (
    SELECT DISTINCT u.id AS user_id, u.role, n.country_id
    FROM users u
    CROSS JOIN LATERAL (VALUES (u.nat1), (u.nat2)) AS n(country_id)
    WHERE n.country_id IS NOT NULL
  ),
  -- Filtered-population role denominators (pivoted to one row).
  rt AS (
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE role = 'player') AS player_total,
      COUNT(*) FILTER (WHERE role = 'coach')  AS coach_total,
      COUNT(*) FILTER (WHERE role = 'club')   AS club_total,
      COUNT(*) FILTER (WHERE role = 'brand')  AS brand_total,
      COUNT(*) FILTER (WHERE role = 'umpire') AS umpire_total
    FROM users
  ),
  country_rows AS (
    SELECT
      np.country_id,
      COALESCE(c.common_name, c.name) AS name,
      c.code,
      c.flag_emoji,
      c.region,
      (c.id IN (SELECT id FROM eu)) AS is_eu,
      COUNT(DISTINCT np.user_id) AS cnt,
      COUNT(DISTINCT np.user_id) FILTER (WHERE np.role = 'player') AS player_cnt,
      COUNT(DISTINCT np.user_id) FILTER (WHERE np.role = 'coach')  AS coach_cnt,
      COUNT(DISTINCT np.user_id) FILTER (WHERE np.role = 'club')   AS club_cnt,
      COUNT(DISTINCT np.user_id) FILTER (WHERE np.role = 'brand')  AS brand_cnt,
      COUNT(DISTINCT np.user_id) FILTER (WHERE np.role = 'umpire') AS umpire_cnt
    FROM nat_pairs np
    JOIN countries c ON c.id = np.country_id
    GROUP BY np.country_id, c.common_name, c.name, c.code, c.flag_emoji, c.region, c.id
  ),
  -- Continent partition by PRIMARY nationality (each user once) → clean donut.
  region_rows AS (
    SELECT c.region, COUNT(*) AS cnt
    FROM users u
    JOIN countries c ON c.id = u.primary_nat
    WHERE u.primary_nat IS NOT NULL AND c.region IS NOT NULL
    GROUP BY c.region
  ),
  -- Per-role summary (EU / dual / missing) over the filtered population.
  role_summary AS (
    SELECT
      role,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE is_eu) AS eu_eligible,
      COUNT(*) FILTER (WHERE is_dual) AS dual,
      COUNT(*) FILTER (WHERE missing_nat) AS missing
    FROM users
    GROUP BY role
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'total_users', rt.total,
        'with_nationality', (SELECT COUNT(*) FROM users WHERE NOT missing_nat),
        'with_nationality_pct', ROUND((SELECT COUNT(*) FROM users WHERE NOT missing_nat) * 100.0 / NULLIF(rt.total, 0), 1),
        'missing_nationality', (SELECT COUNT(*) FROM users WHERE missing_nat),
        'missing_nationality_pct', ROUND((SELECT COUNT(*) FROM users WHERE missing_nat) * 100.0 / NULLIF(rt.total, 0), 1),
        'dual_nationality', (SELECT COUNT(*) FROM users WHERE is_dual),
        'dual_nationality_pct', ROUND((SELECT COUNT(*) FROM users WHERE is_dual) * 100.0 / NULLIF(rt.total, 0), 1),
        'eu_eligible', (SELECT COUNT(*) FROM users WHERE is_eu),
        'eu_eligible_pct', ROUND((SELECT COUNT(*) FROM users WHERE is_eu) * 100.0 / NULLIF(rt.total, 0), 1)
      ) FROM rt
    ),
    'by_role', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'role', rs.role,
        'total', rs.total,
        'eu_eligible', rs.eu_eligible,
        'eu_eligible_pct', ROUND(rs.eu_eligible * 100.0 / NULLIF(rs.total, 0), 1),
        'dual', rs.dual,
        'dual_pct', ROUND(rs.dual * 100.0 / NULLIF(rs.total, 0), 1),
        'missing', rs.missing,
        'missing_pct', ROUND(rs.missing * 100.0 / NULLIF(rs.total, 0), 1)
      ) ORDER BY rs.total DESC)
      FROM role_summary rs
    ), '[]'::jsonb),
    'by_country', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'country_id', cr.country_id,
        'name', cr.name,
        'code', cr.code,
        'flag_emoji', cr.flag_emoji,
        'region', cr.region,
        'is_eu', cr.is_eu,
        'count', cr.cnt,
        'pct_total', ROUND(cr.cnt * 100.0 / NULLIF(rt.total, 0), 1),
        'players', cr.player_cnt,
        'players_pct', ROUND(cr.player_cnt * 100.0 / NULLIF(rt.player_total, 0), 1),
        'coaches', cr.coach_cnt,
        'coaches_pct', ROUND(cr.coach_cnt * 100.0 / NULLIF(rt.coach_total, 0), 1),
        'clubs', cr.club_cnt,
        'brands', cr.brand_cnt,
        'umpires', cr.umpire_cnt
      ) ORDER BY cr.cnt DESC, cr.name ASC)
      FROM country_rows cr CROSS JOIN rt
    ), '[]'::jsonb),
    'by_region', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'region', rr.region,
        'count', rr.cnt,
        'pct', ROUND(rr.cnt * 100.0 / NULLIF((SELECT COUNT(*) FROM users), 0), 1)
      ) ORDER BY rr.cnt DESC)
      FROM region_rows rr
    ), '[]'::jsonb),
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_country_analytics(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_country_analytics(JSONB) TO authenticated;
