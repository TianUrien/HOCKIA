-- Admin "Ecosystem reach" (founder request 2026-11-10): HOCKIA is a niche
-- network for the field hockey ecosystem only, so the useful question is not
-- "how much traffic" but "how much of the field hockey world is here".
--
-- admin_get_ecosystem_reach(p_days) returns one JSON document:
--   countries  per country: players, coaches, club accounts, umpires, brands,
--              members active in the last 30 days, and the clubs known in the
--              world directory (total, claimed) and leagues known.
--              Country = base country, else nationality.
--   totals     the same, summed, plus members with no country.
--   traffic    sessions in the last p_days complete days, split into
--              relevant (member sessions; visitors with field hockey intent),
--              unclear, and not relevant (crawler paths, legal-page bounces).
--   weekly     the same buckets per Monday-start week (13 weeks).
--
-- Members: test accounts, hidden profiles (blocked / frozen minors) and
-- platform admins are excluded. Counts only; no person is returned.
-- Admin-gated, SECURITY DEFINER, explicit REVOKE/GRANT.
--
-- Rollback: supabase/rollbacks/20261110210000_admin_ecosystem_reach.down.sql

CREATE OR REPLACE FUNCTION public.admin_get_ecosystem_reach(p_days INTEGER DEFAULT 28)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := GREATEST(1, LEAST(coalesce(p_days, 28), 180));
  v_end timestamptz := date_trunc('day', now());
  v_start timestamptz := date_trunc('day', now()) - make_interval(days => GREATEST(1, LEAST(coalesce(p_days, 28), 180)));
  v_result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  WITH members AS (
    SELECT coalesce(p.base_country_id, p.nationality_country_id) AS cid,
           p.role,
           (p.last_active_at > now() - interval '30 days') AS active30
    FROM profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE NOT coalesce(p.is_test_account, false)
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      AND NOT coalesce((u.raw_app_meta_data ->> 'is_admin')::boolean, false)
  ),
  by_country AS (
    SELECT cid,
           count(*) FILTER (WHERE role = 'player')  AS players,
           count(*) FILTER (WHERE role = 'coach')   AS coaches,
           count(*) FILTER (WHERE role = 'club')    AS club_accounts,
           count(*) FILTER (WHERE role = 'umpire')  AS umpires,
           count(*) FILTER (WHERE role = 'brand')   AS brands,
           count(*)                                 AS members,
           count(*) FILTER (WHERE active30)         AS active_30d
    FROM members WHERE cid IS NOT NULL GROUP BY cid
  ),
  directory AS (
    SELECT country_id AS cid, count(*) AS known_clubs, count(*) FILTER (WHERE is_claimed) AS claimed_clubs
    FROM world_clubs WHERE country_id IS NOT NULL GROUP BY country_id
  ),
  leagues AS (
    SELECT country_id AS cid, count(*) AS leagues_known FROM world_leagues WHERE country_id IS NOT NULL GROUP BY country_id
  ),
  countries_out AS (
    SELECT c.code AS country_code, c.name AS country_name, c.flag_emoji,
           coalesce(b.players, 0) AS players, coalesce(b.coaches, 0) AS coaches,
           coalesce(b.club_accounts, 0) AS club_accounts, coalesce(b.umpires, 0) AS umpires,
           coalesce(b.brands, 0) AS brands, coalesce(b.members, 0) AS members,
           coalesce(b.active_30d, 0) AS active_30d,
           coalesce(d.known_clubs, 0) AS known_clubs, coalesce(d.claimed_clubs, 0) AS claimed_clubs,
           coalesce(l.leagues_known, 0) AS leagues_known
    FROM countries c
    LEFT JOIN by_country b ON b.cid = c.id
    LEFT JOIN directory d ON d.cid = c.id
    LEFT JOIN leagues l ON l.cid = c.id
    WHERE b.cid IS NOT NULL OR d.cid IS NOT NULL
  ),
  sess AS (
    SELECT e.session_id,
           min(e.created_at) AS started_at,
           bool_or(e.user_id IS NOT NULL) AS member,
           count(*) FILTER (WHERE e.event_name = 'page_view') AS pages,
           bool_or(
             e.event_name IN ('vacancy_view', 'profile_view', 'profile_preview', 'cta_click', 'registration_started',
                              'login', 'search', 'application_submit', 'message_send')
             OR (e.event_name = 'page_view' AND e.properties ->> 'path' ~ '^/(opportunities|community|world|clubs|players|coaches|signup|l/)')
           ) AS hockey_intent,
           bool_or(e.event_name = 'page_view' AND e.properties ->> 'path' ~ '^/(apple-app-site-association|\.well-known|%3C|robots|sitemap)') AS machine_path,
           (array_agg(e.properties ->> 'path' ORDER BY e.created_at) FILTER (WHERE e.event_name = 'page_view'))[1] AS landing
    FROM analytics_events e  -- test accounts and Playwright already excluded by the view
    WHERE e.created_at >= v_end - interval '13 weeks' AND e.created_at < v_end
      AND e.session_id IS NOT NULL
    GROUP BY e.session_id
  ),
  sess_bucket AS (
    SELECT started_at,
           CASE
             WHEN member THEN 'member'
             WHEN machine_path THEN 'not_relevant'
             WHEN hockey_intent THEN 'visitor_hockey_intent'
             WHEN pages <= 1 AND landing ~ '^/(privacy-policy|terms)' THEN 'not_relevant'
             ELSE 'unclear'
           END AS bucket
    FROM sess
  )
  SELECT jsonb_build_object(
    'window_days', v_days,
    'window_start', v_start,
    'window_end', v_end,
    'countries', coalesce((
      SELECT jsonb_agg(to_jsonb(co) ORDER BY co.members DESC, co.known_clubs DESC, co.country_name) FROM countries_out co
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'members', (SELECT count(*) FROM members),
      'members_no_country', (SELECT count(*) FROM members WHERE cid IS NULL),
      'players', (SELECT count(*) FROM members WHERE role = 'player'),
      'coaches', (SELECT count(*) FROM members WHERE role = 'coach'),
      'club_accounts', (SELECT count(*) FROM members WHERE role = 'club'),
      'umpires', (SELECT count(*) FROM members WHERE role = 'umpire'),
      'brands', (SELECT count(*) FROM members WHERE role = 'brand'),
      'active_30d', (SELECT count(*) FROM members WHERE active30),
      'countries_with_members', (SELECT count(*) FROM by_country),
      'known_clubs', (SELECT count(*) FROM world_clubs),
      'claimed_clubs', (SELECT count(*) FROM world_clubs WHERE is_claimed),
      'countries_in_directory', (SELECT count(*) FROM directory)
    ),
    'traffic', jsonb_build_object(
      'member', (SELECT count(*) FROM sess_bucket WHERE bucket = 'member' AND started_at >= v_start),
      'visitor_hockey_intent', (SELECT count(*) FROM sess_bucket WHERE bucket = 'visitor_hockey_intent' AND started_at >= v_start),
      'unclear', (SELECT count(*) FROM sess_bucket WHERE bucket = 'unclear' AND started_at >= v_start),
      'not_relevant', (SELECT count(*) FROM sess_bucket WHERE bucket = 'not_relevant' AND started_at >= v_start)
    ),
    'weekly', coalesce((
      SELECT jsonb_agg(w ORDER BY w.week)
      FROM (
        SELECT to_char(date_trunc('week', started_at), 'YYYY-MM-DD') AS week,
               count(*) FILTER (WHERE bucket = 'member') AS member,
               count(*) FILTER (WHERE bucket = 'visitor_hockey_intent') AS visitor_hockey_intent,
               count(*) FILTER (WHERE bucket = 'unclear') AS unclear,
               count(*) FILTER (WHERE bucket = 'not_relevant') AS not_relevant
        FROM sess_bucket GROUP BY 1
      ) w
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_ecosystem_reach(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_ecosystem_reach(integer) TO authenticated;
