-- Assistant connector: 18+ and block-pair fences (founder decisions 2026-11-27).
--
-- Redefines four functions from 20261125100000_mcp_connector_read_functions.sql;
-- every other line of them is unchanged.
--   1. mcp_guard: a player, coach or umpire must be adult by
--      public.profile_is_adult (known date of birth, 18+ today). Anyone else
--      gets 'account_unavailable', so a minor cannot use the connector at all.
--      Clubs and brands have no date of birth and are unaffected.
--   2. mcp_get_member_profile: the same rule for the member being read. A
--      minor's profile is 'not_found' even by a known id.
--   3. mcp_list_applicants: an applicant in a block relationship with the
--      club, either side, is left out.
--   4. mcp_list_my_opportunities: the applicant counts use the same fence, so
--      list and count agree.
--
-- Connector functions only; installed app builds do not call them.
-- Rollback: supabase/rollbacks/20261127100000_mcp_connector_minors_and_blocks.down.sql
-- Probe: supabase/tests/security/mcp_connector_read_functions.probe.sql (cases B4, B5, Y1-Y4)

-- ── 1. Guard ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_guard(p_tool text, p_max integer, p_window_seconds integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ok boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.mcp_connector_enabled() THEN
    RAISE EXCEPTION 'connector_disabled' USING ERRCODE = 'P0001';
  END IF;

  SELECT true INTO v_ok
    FROM public.profiles p
   WHERE p.id = v_uid
     AND p.onboarding_completed = true
     AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
     -- 18+ (founder decision 2026-11-27): people need a known date of birth
     -- that makes them adult. Unknown counts as not adult, as in the app.
     AND (p.role NOT IN ('player', 'coach', 'umpire') OR public.profile_is_adult(p.date_of_birth));
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- Per tool first, then the hourly ceiling across all tools.
  IF NOT COALESCE((public.check_rate_limit(v_uid::text, 'mcp_' || p_tool, p_max, p_window_seconds) ->> 'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE((public.check_rate_limit(v_uid::text, 'mcp_all', 60, 3600) ->> 'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_guard(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_guard(text, integer, integer) TO service_role;

-- ── 2. My opportunities (recruiters) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_list_my_opportunities()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := public.mcp_guard('list_my_opportunities', 30, 3600);
  v_rows jsonb;
BEGIN
  IF NOT public.is_recruiter(v_uid) THEN
    RETURN jsonb_build_object('error', 'recruiters_only');
  END IF;

  SELECT COALESCE(jsonb_agg(row_json ORDER BY ord), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT row_number() OVER (ORDER BY (o.status = 'open'::public.opportunity_status) DESC, o.created_at DESC, o.id) AS ord,
             jsonb_strip_nulls(jsonb_build_object(
               'id', o.id,
               'title', o.title,
               'type', o.opportunity_type,
               'position', o.position,
               'gender', o.gender,
               'country', o.location_country,
               'status', o.status,
               'created_at', o.created_at,
               'application_deadline', o.application_deadline,
               'applicant_count', COALESCE(c.total, 0),
               'in_review_count', COALESCE(c.pending, 0)
             )) AS row_json
        FROM public.opportunities o
        LEFT JOIN LATERAL (
          SELECT count(*) AS total,
                 count(*) FILTER (WHERE ap.status = 'pending') AS pending
            FROM public.opportunity_applications ap
            JOIN public.profiles app_p ON app_p.id = ap.applicant_id
           WHERE ap.opportunity_id = o.id
             AND NOT public.profile_is_hidden(app_p.is_blocked, app_p.frozen_minor_at)
             AND NOT public.is_blocked_pair(v_uid, app_p.id)
        ) c ON true
       WHERE o.club_id = v_uid
       ORDER BY (o.status = 'open'::public.opportunity_status) DESC, o.created_at DESC, o.id
       LIMIT 50
    ) s;

  RETURN jsonb_build_object('opportunities', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_list_my_opportunities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_list_my_opportunities() TO authenticated, service_role;

-- ── 3. Applicants of one of my opportunities (recruiters) ───────────────────
CREATE OR REPLACE FUNCTION public.mcp_list_applicants(p_opportunity_id uuid, p_page integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := public.mcp_guard('list_applicants', 30, 3600);
  v_page integer := LEAST(GREATEST(COALESCE(p_page, 1), 1), 10);
  v_size constant integer := 20;
  v_title text;
  v_gender text;
  v_target text;
  v_rows jsonb;
  v_count integer;
BEGIN
  IF NOT public.is_recruiter(v_uid) THEN
    RETURN jsonb_build_object('error', 'recruiters_only');
  END IF;

  SELECT o.title, lower(btrim(o.gender::text))
    INTO v_title, v_gender
    FROM public.opportunities o
   WHERE o.id = p_opportunity_id AND o.club_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  -- Mirrors fitTarget() in client/src/lib/clubRecruiting.ts.
  v_target := CASE v_gender
                WHEN 'men' THEN 'Men' WHEN 'boys' THEN 'Men'
                WHEN 'women' THEN 'Women' WHEN 'girls' THEN 'Women'
                WHEN 'mixed' THEN 'Mixed' END;

  WITH page AS (
    SELECT a.id AS application_id, a.status::text AS status, a.applied_at,
           p.id AS person_id, p.full_name, p.role, p.position, p.secondary_position,
           p.nationality, p.base_location, p.playing_category, p.current_club,
           CASE WHEN public.profile_is_adult(p.date_of_birth)
                THEN EXTRACT(YEAR FROM age((timezone('utc', now()))::date, p.date_of_birth))::int END AS age,
           row_number() OVER (ORDER BY a.applied_at DESC, a.id) AS ord
      FROM public.opportunity_applications a
      JOIN public.profiles p ON p.id = a.applicant_id
     WHERE a.opportunity_id = p_opportunity_id
       AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
       AND NOT public.is_blocked_pair(v_uid, p.id)
     ORDER BY a.applied_at DESC, a.id
     LIMIT v_size + 1
    OFFSET (v_page - 1) * v_size
  ),
  fit AS (
    SELECT f.player_id, f.state
      FROM public.compute_club_fit_batch(
             v_uid,
             (SELECT COALESCE(array_agg(pg.person_id), '{}'::uuid[])
                FROM page pg
               WHERE pg.ord <= v_page * v_size
                 AND pg.status NOT IN ('no_response', 'withdrawn', 'filled')),
             v_target, NULL, p_opportunity_id) AS f
     WHERE v_target IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'application_id', pg.application_id,
             'member_id', pg.person_id,
             'full_name', pg.full_name,
             'role', pg.role,
             'position', pg.position,
             'secondary_position', pg.secondary_position,
             'nationality', pg.nationality,
             'base_location', pg.base_location,
             'playing_category', pg.playing_category,
             'current_club', pg.current_club,
             'age', pg.age,
             'applied_at', pg.applied_at,
             'status', public.mcp_application_status_label(pg.status, true),
             'fit', fit.state
           )) ORDER BY pg.ord) FILTER (WHERE pg.ord <= v_page * v_size), '[]'::jsonb),
         count(*)
    INTO v_rows, v_count
    FROM page pg
    LEFT JOIN fit ON fit.player_id = pg.person_id;

  RETURN jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'title', v_title,
    'page', v_page,
    'has_more', v_count > v_size AND v_page < 10,
    'applicants', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_list_applicants(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_list_applicants(uuid, integer) TO authenticated, service_role;

-- ── 4. One member's public profile ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_get_member_profile(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := public.mcp_guard('get_member_profile', 60, 86400);
  v_recruiter boolean := public.is_recruiter(v_uid);
  v_out jsonb;
BEGIN
  SELECT jsonb_strip_nulls(jsonb_build_object(
      'member_id', p.id,
      'role', p.role,
      'username', p.username,
      'full_name', p.full_name,
      'base_location', p.base_location,
      'nationality', p.nationality,
      'bio', left(COALESCE(p.bio, p.club_bio), 1500),
      'is_verified', p.is_verified,
      'gender', CASE WHEN p.role IN ('player', 'coach', 'umpire') THEN p.gender END,
      'age', CASE WHEN p.role IN ('player', 'coach', 'umpire') AND public.profile_is_adult(p.date_of_birth)
                  THEN EXTRACT(YEAR FROM age((timezone('utc', now()))::date, p.date_of_birth))::int END,
      'position', CASE WHEN p.role = 'player' THEN p.position END,
      'secondary_position', CASE WHEN p.role = 'player' THEN p.secondary_position END,
      'playing_category', CASE WHEN p.role = 'player' THEN p.playing_category END,
      'specialist_skills', CASE WHEN p.role = 'player' THEN NULLIF(to_jsonb(p.specialist_skills), '[]'::jsonb) END,
      'current_club', CASE WHEN p.role IN ('player', 'coach') THEN p.current_club END,
      'coach_specialization', CASE WHEN p.role = 'coach' THEN p.coach_specialization END,
      'open_to_offers', CASE p.role WHEN 'player' THEN p.open_to_play WHEN 'coach' THEN p.open_to_coach END,
      'available_from', CASE WHEN p.role IN ('player', 'coach') THEN p.available_from END,
      'opportunity_preference', CASE WHEN p.role IN ('player', 'coach') THEN p.opportunity_preference END,
      'relocation_willingness', CASE WHEN p.role IN ('player', 'coach') THEN p.relocation_willingness END,
      'level_target', CASE WHEN v_recruiter AND p.role = 'player' THEN p.level_target END,
      'accepted_reference_count', CASE WHEN p.role IN ('player', 'coach', 'umpire') THEN p.accepted_reference_count END,
      'career_entry_count', CASE WHEN p.role IN ('player', 'coach') THEN p.career_entry_count END,
      'year_founded', CASE WHEN p.role = 'club' THEN p.year_founded END,
      'website', CASE WHEN p.role = 'club' THEN p.website END,
      'womens_league', CASE WHEN p.role = 'club' THEN p.womens_league_division END,
      'mens_league', CASE WHEN p.role = 'club' THEN p.mens_league_division END,
      'umpire_level', CASE WHEN p.role = 'umpire' THEN p.umpire_level END,
      'federation', CASE WHEN p.role = 'umpire' THEN p.federation END,
      'available_for_appointments', CASE WHEN p.role = 'umpire' THEN p.available_for_appointments END
    ))
    INTO v_out
    FROM public.profiles p
   WHERE p.id = p_member_id
     AND p.onboarding_completed = true
     AND p.role IN ('player', 'coach', 'club', 'umpire', 'brand')
     AND (public.is_staging_env() OR p.is_test_account = false)
     AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
     AND (p.id = v_uid OR NOT public.is_blocked_pair(v_uid, p.id))
     AND (p.role NOT IN ('player', 'coach', 'umpire') OR public.profile_is_adult(p.date_of_birth));

  IF v_out IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_get_member_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_get_member_profile(uuid) TO authenticated, service_role;
