-- Home: "What's your goal?" v1 and the "Gear and deals near you" rail
-- (founder 2026-10-25; Figma page 02, section YG: G1–G5, HR1).
--
-- 1. member_goals: a member's own goal, PRIVATE. Never on the profile, in
--    search, or per person to clubs or brands (aggregates of 5+ only, later).
--    Read and written only through the RPCs below; anon has nothing.
-- 2. get_my_goal_actions: the set card's rows from real data only (open roles
--    abroad / where the member lives for their role and position; a club's
--    open roles and applicants waiting). Hidden clubs and applicants are never
--    counted.
-- 3. get_home_gear_rail: up to N tiles: eligible offers first (Phase 2 rules,
--    unseen first), then products from brands with a live offer in the
--    member's country, newest first. Same member fences as offers (adults
--    only, not hidden, no blocked pair, brand not hidden by the member).
--
-- Rollback: supabase/rollbacks/20261025150000_member_goals_and_gear_rail.down.sql

-- ------------------------------------------------------------ goals
CREATE TABLE public.member_goals (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  options text[] NOT NULL DEFAULT '{}',
  other_text text CHECK (other_text IS NULL OR char_length(other_text) BETWEEN 1 AND 120),
  set_at timestamptz,
  later_count integer NOT NULL DEFAULT 0,
  later_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_goals_max_three CHECK (cardinality(options) + (CASE WHEN other_text IS NULL THEN 0 ELSE 1 END) <= 3)
);
ALTER TABLE public.member_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.member_goals FROM anon, authenticated;

-- The option keys a role may pick (Figma YG; copy lives in the client).
CREATE OR REPLACE FUNCTION public.goal_option_keys(p_role text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'player' THEN ARRAY['play_abroad', 'move_up', 'club_near_me', 'get_sponsor', 'keep_playing']
    WHEN 'coach'  THEN ARRAY['coach_abroad', 'coach_higher', 'club_near_me', 'recruit_players', 'grow_coach']
    WHEN 'club'   THEN ARRAY['fill_role', 'sign_abroad', 'find_coach', 'find_sponsors', 'grow_club']
    WHEN 'brand'  THEN ARRAY['find_ambassadors', 'reach_new_countries', 'reach_clubs']
    WHEN 'umpire' THEN ARRAY['umpire_higher', 'umpire_abroad', 'build_record']
    ELSE ARRAY[]::text[]
  END;
$$;

-- The member's goal and whether Home should ask (G1 / G4).
CREATE OR REPLACE FUNCTION public.get_my_goal()
RETURNS TABLE (options text[], other_text text, set_at timestamptz, later_count integer, should_ask boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(g.options, '{}'), g.other_text, g.set_at, coalesce(g.later_count, 0),
         (g.set_at IS NULL AND coalesce(g.later_count, 0) < 2 AND (g.later_until IS NULL OR g.later_until <= now()))
    FROM (SELECT (SELECT auth.uid()) AS uid) me
    LEFT JOIN public.member_goals g ON g.profile_id = me.uid
   WHERE me.uid IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.get_my_goal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_goal() TO authenticated;

-- Set or change the goal: up to three picks in total, "Other…" counts as one.
CREATE OR REPLACE FUNCTION public.set_my_goal(p_options text[], p_other_text text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_role text;
  v_options text[] := ARRAY(SELECT DISTINCT unnest(coalesce(p_options, '{}')));
  v_other text := nullif(btrim(p_other_text), '');
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_me;
  IF EXISTS (SELECT 1 FROM unnest(v_options) o WHERE o <> ALL (public.goal_option_keys(v_role))) THEN
    RAISE EXCEPTION 'invalid_goal' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(v_options) + (CASE WHEN v_other IS NULL THEN 0 ELSE 1 END) NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'goal_count' USING ERRCODE = 'check_violation';
  END IF;
  IF v_other IS NOT NULL AND char_length(v_other) > 120 THEN
    RAISE EXCEPTION 'goal_text_too_long' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.member_goals (profile_id, options, other_text, set_at, updated_at)
  VALUES (v_me, v_options, v_other, now(), now())
  ON CONFLICT (profile_id) DO UPDATE SET options = EXCLUDED.options, other_text = EXCLUDED.other_text,
                                         set_at = now(), updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_goal(text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_goal(text[], text) TO authenticated;

-- "Later": hide the ask for 7 days; after the second time Home stops asking.
CREATE OR REPLACE FUNCTION public.goal_later()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_count integer;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = 'insufficient_privilege'; END IF;
  INSERT INTO public.member_goals (profile_id, later_count, later_until)
  VALUES (v_me, 1, now() + interval '7 days')
  ON CONFLICT (profile_id) DO UPDATE SET later_count = member_goals.later_count + 1,
                                         later_until = now() + interval '7 days', updated_at = now()
  RETURNING later_count INTO v_count;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.goal_later() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.goal_later() TO authenticated;

-- ------------------------------------------------------------ set-card rows
-- A country "family": the UK nations count as one place (GB, GB-ENG, …), so a
-- member in the United Kingdom never sees England roles as "abroad".
CREATE OR REPLACE FUNCTION public.country_family_by_name(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN c.code LIKE 'GB%' THEN 'GB' ELSE c.code END
    FROM public.countries c
   WHERE lower(c.name) = lower(btrim(p_name)) OR lower(c.common_name) = lower(btrim(p_name))
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_my_goal_actions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  m record;
  v_family text;
  v_type text;
  v_abroad integer := 0;
  v_home integer := 0;
  v_open integer := 0;
  v_waiting integer := 0;
BEGIN
  IF v_me IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT p.id, p.role, p.position, p.base_country_id INTO m FROM public.profiles p WHERE p.id = v_me;
  SELECT CASE WHEN c.code LIKE 'GB%' THEN 'GB' ELSE c.code END INTO v_family FROM public.countries c WHERE c.id = m.base_country_id;

  IF m.role IN ('player', 'coach') THEN
    v_type := m.role;
    WITH roles AS (
      SELECT public.country_family_by_name(o.location_country) AS fam
        FROM public.opportunities o
        JOIN public.profiles club ON club.id = o.club_id
       WHERE o.status = 'open'
         AND o.opportunity_type::text = v_type
         AND (m.role <> 'player' OR m.position IS NULL OR o.position IS NULL OR o.position::text = m.position)
         AND (o.application_deadline IS NULL OR o.application_deadline >= current_date)
         AND NOT public.profile_is_hidden(club.is_blocked, club.frozen_minor_at)
         AND NOT public.is_blocked_pair(v_me, o.club_id)
    )
    SELECT count(*) FILTER (WHERE v_family IS NOT NULL AND fam IS NOT NULL AND fam <> v_family),
           count(*) FILTER (WHERE v_family IS NOT NULL AND fam = v_family)
      INTO v_abroad, v_home
      FROM roles;
    RETURN jsonb_build_object('roles_abroad', v_abroad, 'roles_home', v_home, 'position', m.position);
  ELSIF m.role = 'club' THEN
    SELECT count(*) INTO v_open FROM public.opportunities o WHERE o.club_id = v_me AND o.status = 'open';
    SELECT count(*) INTO v_waiting
      FROM public.opportunity_applications a
      JOIN public.opportunities o ON o.id = a.opportunity_id
      JOIN public.profiles ap ON ap.id = a.applicant_id
     WHERE o.club_id = v_me AND o.status = 'open' AND a.status = 'pending'
       AND NOT public.profile_is_hidden(ap.is_blocked, ap.frozen_minor_at);
    RETURN jsonb_build_object('open_roles', v_open, 'applicants_waiting', v_waiting);
  END IF;
  RETURN '{}'::jsonb;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_goal_actions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_goal_actions() TO authenticated;

-- ------------------------------------------------------------ gear rail
CREATE OR REPLACE FUNCTION public.get_home_gear_rail(p_limit integer DEFAULT 6)
RETURNS TABLE (
  kind text, id uuid, brand_id uuid, brand_name text, brand_slug text, brand_logo_url text,
  brand_profile_id uuid, title text, image_url text, link_url text, member_country_id integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  m record;
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 12);
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;
  SELECT p.id, p.role, p.base_country_id, p.is_blocked, p.frozen_minor_at, p.date_of_birth INTO m FROM public.profiles p WHERE p.id = v_me;
  -- Same member fences as offers: never hidden members, never minors (club accounts are organisations).
  IF m.base_country_id IS NULL OR public.profile_is_hidden(m.is_blocked, m.frozen_minor_at)
     OR NOT (m.role = 'club' OR public.profile_is_adult(m.date_of_birth)) OR m.role = 'brand' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH offers AS (
    SELECT 'offer'::text AS kind, o.id, o.brand_id, o.brand_name, o.brand_slug, o.brand_logo_url, o.brand_profile_id,
           o.title, o.image_url, o.link_url, o.member_country_id, 0 AS grp, o.last_shown_at AS shown, NULL::timestamptz AS created
      FROM public.get_brand_offers_for_me(v_limit) o
  ),
  selling AS (
    SELECT DISTINCT bo.brand_id
      FROM public.brand_offers bo
     WHERE bo.status = 'live'
       AND (bo.starts_at IS NULL OR bo.starts_at <= now())
       AND (bo.ends_at IS NULL OR bo.ends_at > now())
       AND m.base_country_id = ANY (bo.country_ids)
  ),
  products AS (
    SELECT 'product'::text, bp.id, b.id, b.name, b.slug, b.logo_url, b.profile_id,
           bp.name, (SELECT x->>'url' FROM jsonb_array_elements(coalesce(bp.images, '[]'::jsonb)) x ORDER BY (x->>'order')::int NULLS LAST LIMIT 1),
           bp.external_url, m.base_country_id, 1, NULL::timestamptz, bp.created_at
      FROM public.brand_products bp
      JOIN public.brands b ON b.id = bp.brand_id
     WHERE bp.deleted_at IS NULL
       AND b.id IN (SELECT s.brand_id FROM selling s)
       AND public.brand_is_visible(b.id)
       AND b.profile_id <> v_me
       AND NOT public.is_blocked_pair(v_me, b.profile_id)
       AND NOT EXISTS (SELECT 1 FROM public.brand_hides h WHERE h.user_id = v_me AND h.brand_id = b.id)
  )
  SELECT t.kind, t.id, t.brand_id, t.brand_name, t.brand_slug, t.brand_logo_url, t.brand_profile_id,
         t.title, t.image_url, t.link_url, t.member_country_id
    FROM (SELECT * FROM offers UNION ALL SELECT * FROM products) t
   ORDER BY t.grp, t.shown ASC NULLS FIRST, t.created DESC NULLS LAST
   LIMIT v_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.get_home_gear_rail(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_home_gear_rail(integer) TO authenticated;
