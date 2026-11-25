-- Assistant connector: read-only functions (founder decision 2026-11-24).
--
-- Members will be able to connect an AI assistant to their own Hockia account
-- through a connector. The connector calls these eight functions as the
-- signed-in member and nothing else. Each one:
--   - answers only for auth.uid(); there is no "act as" parameter;
--   - returns a fixed list of fields (never date of birth, email, phone,
--     last-active, internal flags);
--   - applies the hidden-profile, test-account, block-pair and adult fences
--     itself (SECURITY DEFINER bypasses RLS);
--   - gives fit only to the recruiter who owns the role, and gives players no
--     counts, scores, levels or rankings;
--   - counts against a per-member limit (rate_limits, action 'mcp_*').
-- Nothing here writes member data; the only write is the rate-limit row.
--
-- Switch: app_settings key 'mcp_connector_enabled'. Absent row = OFF, and
-- every function then answers 'connector_disabled'. Turn on with:
--   INSERT INTO public.app_settings (key, value) VALUES ('mcp_connector_enabled', 'true')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- Refusals from the guard are raised with ERRCODE P0001 and one of these
-- messages: not_authenticated, connector_disabled, account_unavailable,
-- rate_limited. A tool that does not apply to the caller, or an id the caller
-- may not see, is answered as {"error": "recruiters_only" | "not_found"}: a
-- normal result, so the call still counts against the limits.
--
-- Additive: no existing object changes, so installed app builds are unaffected.
-- Rollback: supabase/rollbacks/20261125100000_mcp_connector_read_functions.down.sql

-- ── 0. Switch ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_connector_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_settings
    WHERE key = 'mcp_connector_enabled' AND value = 'true'
  );
$$;

REVOKE ALL ON FUNCTION public.mcp_connector_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_connector_enabled() TO authenticated, service_role;

COMMENT ON FUNCTION public.mcp_connector_enabled() IS
  'Runtime switch for the assistant connector (app_settings key mcp_connector_enabled). Absent row = OFF.';

-- ── 1. Guard: caller, switch, account state, limits ─────────────────────────
-- Server only. Called first by every mcp_* function. Returns the caller id.
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
     AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at);
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

-- The applicant-facing words for an application status (English), the same
-- set as client/src/locales/en/opportunities.core.json "status".
CREATE OR REPLACE FUNCTION public.mcp_application_status_label(p_status text, p_role_open boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_status = 'pending' AND NOT COALESCE(p_role_open, false) THEN 'Opportunity closed'
    WHEN p_status = 'pending' THEN 'In review'
    WHEN p_status IN ('shortlisted', 'offer_declined') THEN 'Shortlisted'
    WHEN p_status = 'maybe' THEN 'Replied'
    WHEN p_status = 'rejected' THEN 'Not this time'
    WHEN p_status = 'withdrawn' THEN 'Withdrawn'
    WHEN p_status = 'no_response' THEN 'No reply'
    WHEN p_status = 'filled' THEN 'Opportunity filled'
    WHEN p_status = 'offered' THEN 'Offer'
    WHEN p_status = 'accepted' THEN 'Offer accepted'
    WHEN p_status = 'signed_pending_confirmation' THEN 'Confirm signing'
    WHEN p_status = 'signed' THEN 'Signed'
    ELSE 'In review'
  END;
$$;

REVOKE ALL ON FUNCTION public.mcp_application_status_label(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_application_status_label(text, boolean) TO service_role;

-- ── 2. My profile ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := public.mcp_guard('get_my_profile', 30, 3600);
  v_out jsonb;
BEGIN
  SELECT jsonb_strip_nulls(jsonb_build_object(
      'id', p.id,
      'role', p.role,
      'username', p.username,
      'full_name', p.full_name,
      'base_location', p.base_location,
      'nationality', p.nationality,
      'gender', p.gender,
      'position', p.position,
      'secondary_position', p.secondary_position,
      'playing_category', p.playing_category,
      'current_club', p.current_club,
      'bio', left(COALESCE(p.bio, p.club_bio), 1500),
      'coach_specialization', p.coach_specialization,
      'recruits_for_team', CASE WHEN p.role = 'coach' THEN p.coach_recruits_for_team END,
      'open_to_play', CASE WHEN p.role = 'player' THEN p.open_to_play END,
      'open_to_coach', CASE WHEN p.role = 'coach' THEN p.open_to_coach END,
      'available_for_appointments', CASE WHEN p.role = 'umpire' THEN p.available_for_appointments END,
      'available_from', p.available_from,
      'opportunity_preference', p.opportunity_preference,
      'relocation_willingness', p.relocation_willingness,
      'specialist_skills', NULLIF(to_jsonb(p.specialist_skills), '[]'::jsonb),
      'is_verified', p.is_verified,
      'accepted_reference_count', p.accepted_reference_count,
      'career_entry_count', p.career_entry_count,
      'completeness', jsonb_build_object(
          'pct', public.compute_profile_completeness_pct(p),
          'missing', (SELECT COALESCE(jsonb_agg(x->>'key'), '[]'::jsonb)
                        FROM jsonb_array_elements(public.profile_completeness_parts(p)) AS x
                       WHERE NOT COALESCE((x->>'done')::boolean, false)))
    ))
    INTO v_out
    FROM public.profiles p
   WHERE p.id = v_uid;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_get_my_profile() TO authenticated, service_role;

-- ── 3. Search open opportunities ────────────────────────────────────────────
-- Same publisher fences as the public_opportunities view, plus the block-pair
-- fence of the "Public can view open opportunities" policy.
CREATE OR REPLACE FUNCTION public.mcp_search_opportunities(
  p_type text DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_gender text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_page integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := public.mcp_guard('search_opportunities', 40, 3600);
  v_page integer := LEAST(GREATEST(COALESCE(p_page, 1), 1), 10);
  v_size constant integer := 10;
  v_query text := NULLIF(btrim(left(COALESCE(p_query, ''), 80)), '');
  v_country text := NULLIF(btrim(left(COALESCE(p_country, ''), 60)), '');
  v_rows jsonb;
  v_count integer;
BEGIN
  SELECT COALESCE(jsonb_agg(row_json ORDER BY ord), '[]'::jsonb), count(*)
    INTO v_rows, v_count
    FROM (
      SELECT row_number() OVER (ORDER BY COALESCE(o.published_at, o.created_at) DESC, o.id) AS ord,
             jsonb_strip_nulls(jsonb_build_object(
               'id', o.id,
               'title', o.title,
               'type', o.opportunity_type,
               'position', o.position,
               'gender', o.gender,
               'city', o.location_city,
               'country', o.location_country,
               'organisation', COALESCE(NULLIF(btrim(o.organization_name), ''), wc.club_name, p.full_name),
               'published_by', p.role,
               'start_date', o.start_date,
               'duration', o.duration_text,
               'application_deadline', o.application_deadline,
               'eu_passport_required', o.eu_passport_required,
               'published_at', COALESCE(o.published_at, o.created_at),
               'summary', left(o.description, 300)
             )) AS row_json
        FROM public.opportunities o
        JOIN public.profiles p ON p.id = o.club_id
        LEFT JOIN public.world_clubs wc ON wc.id = o.world_club_id
       WHERE o.status = 'open'::public.opportunity_status
         AND (public.is_staging_env() OR COALESCE(p.is_test_account, false) = false)
         AND p.onboarding_completed = true
         AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
         AND NOT public.is_blocked_pair(v_uid, o.club_id)
         AND (p_type IS NULL OR o.opportunity_type::text = lower(p_type))
         AND (p_position IS NULL OR o.position::text = lower(p_position))
         AND (p_gender IS NULL OR lower(o.gender::text) = lower(p_gender))
         AND (v_country IS NULL OR o.location_country ILIKE '%' || v_country || '%')
         AND (v_query IS NULL
              OR o.title ILIKE '%' || v_query || '%'
              OR o.description ILIKE '%' || v_query || '%'
              OR o.location_city ILIKE '%' || v_query || '%')
       ORDER BY COALESCE(o.published_at, o.created_at) DESC, o.id
       LIMIT v_size + 1
      OFFSET (v_page - 1) * v_size
    ) s;

  RETURN jsonb_build_object(
    'page', v_page,
    'has_more', v_count > v_size AND v_page < 10,
    'opportunities', COALESCE((SELECT jsonb_agg(e ORDER BY i)
                                 FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(e, i)
                                WHERE i <= v_size), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_search_opportunities(text, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_search_opportunities(text, text, text, text, text, integer) TO authenticated, service_role;

-- ── 4. One open opportunity ─────────────────────────────────────────────────
-- No contact details in this version. Adds the caller's own application status.
CREATE OR REPLACE FUNCTION public.mcp_get_opportunity(p_opportunity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := public.mcp_guard('get_opportunity', 60, 3600);
  v_out jsonb;
BEGIN
  SELECT jsonb_strip_nulls(jsonb_build_object(
      'id', o.id,
      'title', o.title,
      'type', o.opportunity_type,
      'position', o.position,
      'gender', o.gender,
      'city', o.location_city,
      'country', o.location_country,
      'organisation', COALESCE(NULLIF(btrim(o.organization_name), ''), wc.club_name, p.full_name),
      'published_by', p.role,
      'start_date', o.start_date,
      'duration', o.duration_text,
      'application_deadline', o.application_deadline,
      'eu_passport_required', o.eu_passport_required,
      'published_at', COALESCE(o.published_at, o.created_at),
      'description', left(o.description, 4000),
      'requirements', NULLIF(to_jsonb(o.requirements), '[]'::jsonb),
      'benefits', NULLIF(to_jsonb(o.benefits), '[]'::jsonb),
      'other_benefits', NULLIF(to_jsonb(o.custom_benefits), '[]'::jsonb),
      'my_application', (SELECT jsonb_build_object(
                                  'applied_at', a.applied_at,
                                  'status', public.mcp_application_status_label(a.status::text, true))
                           FROM public.opportunity_applications a
                          WHERE a.opportunity_id = o.id AND a.applicant_id = v_uid
                          LIMIT 1)
    ))
    INTO v_out
    FROM public.opportunities o
    JOIN public.profiles p ON p.id = o.club_id
    LEFT JOIN public.world_clubs wc ON wc.id = o.world_club_id
   WHERE o.id = p_opportunity_id
     AND o.status = 'open'::public.opportunity_status
     AND (public.is_staging_env() OR COALESCE(p.is_test_account, false) = false)
     AND p.onboarding_completed = true
     AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
     AND NOT public.is_blocked_pair(v_uid, o.club_id);

  IF v_out IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_get_opportunity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_get_opportunity(uuid) TO authenticated, service_role;

-- ── 5. My applications ──────────────────────────────────────────────────────
-- The caller's own rows. No counts and no fit. A hidden publisher's name is
-- left out; the application itself stays listed, as in the app.
CREATE OR REPLACE FUNCTION public.mcp_list_my_applications(p_page integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := public.mcp_guard('list_my_applications', 30, 3600);
  v_page integer := LEAST(GREATEST(COALESCE(p_page, 1), 1), 10);
  v_size constant integer := 20;
  v_rows jsonb;
  v_count integer;
BEGIN
  SELECT COALESCE(jsonb_agg(row_json ORDER BY ord) FILTER (WHERE ord <= v_page * v_size), '[]'::jsonb), count(*)
    INTO v_rows, v_count
    FROM (
      SELECT row_number() OVER (ORDER BY a.applied_at DESC, a.id) AS ord,
             jsonb_strip_nulls(jsonb_build_object(
               'application_id', a.id,
               'opportunity_id', o.id,
               'title', o.title,
               'type', o.opportunity_type,
               'position', o.position,
               'country', o.location_country,
               'organisation', CASE WHEN public.profile_is_hidden(p.is_blocked, p.frozen_minor_at) THEN NULL
                                    ELSE COALESCE(NULLIF(btrim(o.organization_name), ''), p.full_name) END,
               'applied_at', a.applied_at,
               'status', public.mcp_application_status_label(a.status::text, o.status = 'open'::public.opportunity_status),
               'opportunity_open', o.status = 'open'::public.opportunity_status
             )) AS row_json
        FROM public.opportunity_applications a
        JOIN public.opportunities o ON o.id = a.opportunity_id
        JOIN public.profiles p ON p.id = o.club_id
       WHERE a.applicant_id = v_uid
       ORDER BY a.applied_at DESC, a.id
       LIMIT v_size + 1
      OFFSET (v_page - 1) * v_size
    ) s;

  RETURN jsonb_build_object('page', v_page, 'has_more', v_count > v_size AND v_page < 10, 'applications', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_list_my_applications(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_list_my_applications(integer) TO authenticated, service_role;

-- ── 6. My opportunities (recruiters) ────────────────────────────────────────
-- Counts use the same hidden-applicant fence as get_my_roles_health, so the
-- numbers agree with the app and with mcp_list_applicants.
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

-- ── 7. Applicants of one of my opportunities (recruiters) ───────────────────
-- Hidden applicants are left out (same rule as the count above). Fit is the
-- state only, from compute_club_fit_batch, which answers only for the owner.
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

-- ── 8. Find players and coaches (recruiters) ────────────────────────────────
-- Fences copied from community_search_members (20261109180000). Ten per page,
-- five pages deep, no total: the directory cannot be walked through this.
-- Two limits: 20 per hour (in the guard) and 60 per day.
CREATE OR REPLACE FUNCTION public.mcp_search_members(
  p_role text DEFAULT 'player',
  p_position text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_nationality text DEFAULT NULL,
  p_open_only boolean DEFAULT false,
  p_query text DEFAULT NULL,
  p_page integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := public.mcp_guard('search_members', 20, 3600);
  v_page integer := LEAST(GREATEST(COALESCE(p_page, 1), 1), 5);
  v_size constant integer := 10;
  v_role text := lower(COALESCE(p_role, 'player'));
  v_position text := NULLIF(lower(btrim(left(COALESCE(p_position, ''), 40))), '');
  v_location text := NULLIF(btrim(left(COALESCE(p_location, ''), 60)), '');
  v_nationality text := NULLIF(btrim(left(COALESCE(p_nationality, ''), 60)), '');
  v_query text := NULLIF(btrim(left(COALESCE(p_query, ''), 80)), '');
  v_rows jsonb;
  v_count integer;
BEGIN
  IF NOT public.is_recruiter(v_uid) THEN
    RETURN jsonb_build_object('error', 'recruiters_only');
  END IF;
  IF NOT COALESCE((public.check_rate_limit(v_uid::text, 'mcp_search_members_day', 60, 86400) ->> 'allowed')::boolean, false) THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001';
  END IF;
  IF v_role NOT IN ('player', 'coach') THEN
    v_role := 'player';
  END IF;

  SELECT COALESCE(jsonb_agg(row_json ORDER BY ord) FILTER (WHERE ord <= v_page * v_size), '[]'::jsonb), count(*)
    INTO v_rows, v_count
    FROM (
      SELECT row_number() OVER (ORDER BY (p.role = 'player' AND COALESCE(p.open_to_play, false)) DESC, p.created_at DESC, p.id) AS ord,
             jsonb_strip_nulls(jsonb_build_object(
               'member_id', p.id,
               'full_name', p.full_name,
               'role', p.role,
               'position', p.position,
               'secondary_position', p.secondary_position,
               'coach_specialization', CASE WHEN p.role = 'coach' THEN p.coach_specialization END,
               'nationality', p.nationality,
               'base_location', p.base_location,
               'playing_category', p.playing_category,
               'current_club', p.current_club,
               'open_to_offers', CASE p.role WHEN 'player' THEN p.open_to_play WHEN 'coach' THEN p.open_to_coach END,
               'available_from', p.available_from,
               'age', CASE WHEN public.profile_is_adult(p.date_of_birth)
                           THEN EXTRACT(YEAR FROM age((timezone('utc', now()))::date, p.date_of_birth))::int END
             )) AS row_json
        FROM public.profiles p
       WHERE p.onboarding_completed = true
         AND p.id <> v_uid
         AND p.role = v_role
         AND (public.is_staging_env() OR p.is_test_account = false)
         AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
         AND (p.role <> 'player' OR public.profile_is_adult(p.date_of_birth))
         AND NOT public.is_blocked_pair(v_uid, p.id)
         AND (v_position IS NULL OR lower(p.position) = v_position OR lower(p.secondary_position) = v_position)
         AND (v_location IS NULL OR p.base_location ILIKE '%' || v_location || '%')
         AND (v_nationality IS NULL OR p.nationality ILIKE '%' || v_nationality || '%')
         AND (NOT COALESCE(p_open_only, false)
              OR CASE p.role WHEN 'player' THEN p.open_to_play WHEN 'coach' THEN p.open_to_coach END = true)
         AND (v_query IS NULL OR p.search_vector @@ plainto_tsquery('english', v_query))
       ORDER BY (p.role = 'player' AND COALESCE(p.open_to_play, false)) DESC, p.created_at DESC, p.id
       LIMIT v_size + 1
      OFFSET (v_page - 1) * v_size
    ) s;

  RETURN jsonb_build_object('page', v_page, 'has_more', v_count > v_size AND v_page < 5, 'members', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_search_members(text, text, text, text, boolean, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_search_members(text, text, text, text, boolean, text, integer) TO authenticated, service_role;

-- ── 9. One member's public profile ──────────────────────────────────────────
-- Not onboarded, hidden, test (outside staging) or in a block relationship
-- with the caller, either side: the same 'not_found' as an id that does not
-- exist. The stated level target is returned to recruiters only.
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
     AND (p.id = v_uid OR NOT public.is_blocked_pair(v_uid, p.id));

  IF v_out IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.mcp_get_member_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_get_member_profile(uuid) TO authenticated, service_role;
