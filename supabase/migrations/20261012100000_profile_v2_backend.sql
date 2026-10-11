-- Profile v2 backend (Figma t24oVt… page 04, spec 132:1000; founder rulings 11 Oct 2026).
--
-- 1. Completeness parts for EVERY role. The own-profile strength card picks its
--    one next step from these (photo / crest / logo first for a new profile,
--    then the highest-weight missing part). compute_profile_completeness_pct
--    becomes the sum of the parts for every role, so score and checklist can
--    never disagree. Weights are unchanged except one ruling:
--      umpire: no "career" part; appointments carry its weight (10 + 10 = 20).
-- 2. get_club_members (Squad faces + member count) gets the Community fences:
--    the age-gate "uncontactable" rule and no one in a block relationship with
--    the viewer, either side.
-- 3. brands.cover_url (restored; dropped in 202603230200) and
--    brands.open_to_partners ("Looking for ambassadors").
-- 4. get_my_product_tap_stats: product click-outs, brand-only aggregates. The
--    client logs 'brand_product_click' through track_event, only with analytics
--    consent.

-- ── 1. Parts per role ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.profile_completeness_parts(p public.profiles)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  b RECORD;
  v_has_brand boolean := false;
BEGIN
  IF p.role IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF p.role = 'player' THEN
    RETURN public.player_completeness_parts(p);

  ELSIF p.role = 'coach' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('key', 'photo',      'weight', 10, 'done', COALESCE(length(btrim(p.avatar_url)), 0) > 0),
      jsonb_build_object('key', 'bio',        'weight', 10, 'done', COALESCE(length(btrim(p.bio)), 0) > 0),
      jsonb_build_object('key', 'nationality_base', 'weight', 10, 'done',
        (p.nationality_country_id IS NOT NULL OR COALESCE(length(btrim(p.nationality)), 0) > 0)
        AND COALESCE(length(btrim(p.base_location)), 0) > 0),
      jsonb_build_object('key', 'specialization', 'weight', 10, 'done',
        COALESCE(array_length(p.coaching_categories, 1), 0) > 0 OR COALESCE(length(btrim(p.coach_specialization)), 0) > 0),
      jsonb_build_object('key', 'current_club', 'weight', 10, 'done', COALESCE(length(btrim(p.current_club)), 0) > 0),
      jsonb_build_object('key', 'career',     'weight', 15, 'done', COALESCE(p.career_entry_count, 0) > 0),
      jsonb_build_object('key', 'gallery',    'weight', 5,  'done', COALESCE(p.gallery_photo_count, 0) > 0),
      jsonb_build_object('key', 'friends',    'weight', 5,  'done', COALESCE(p.accepted_friend_count, 0) > 0),
      jsonb_build_object('key', 'references', 'weight', 15, 'done', COALESCE(p.accepted_reference_count, 0) > 0),
      jsonb_build_object('key', 'open_to_coach', 'weight', 10, 'done', p.open_to_coach IS TRUE)
    );

  ELSIF p.role = 'club' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('key', 'crest',      'weight', 15, 'done', COALESCE(length(btrim(p.avatar_url)), 0) > 0),
      jsonb_build_object('key', 'bio',        'weight', 20, 'done',
        COALESCE(length(btrim(p.club_bio)), 0) > 0 OR COALESCE(length(btrim(p.bio)), 0) > 0),
      jsonb_build_object('key', 'base_location', 'weight', 10, 'done', COALESCE(length(btrim(p.base_location)), 0) > 0),
      jsonb_build_object('key', 'country',    'weight', 5,  'done', p.nationality_country_id IS NOT NULL),
      jsonb_build_object('key', 'year_founded', 'weight', 10, 'done', p.year_founded IS NOT NULL),
      jsonb_build_object('key', 'contact',    'weight', 10, 'done',
        (COALESCE(length(btrim(p.contact_email)), 0) > 0 AND p.contact_email_public IS TRUE)
        OR COALESCE(length(btrim(p.website)), 0) > 0),
      jsonb_build_object('key', 'media',      'weight', 15, 'done', COALESCE(p.club_media_count, 0) > 0),
      jsonb_build_object('key', 'posts',      'weight', 10, 'done', COALESCE(p.post_count, 0) > 0),
      jsonb_build_object('key', 'friends',    'weight', 5,  'done', COALESCE(p.accepted_friend_count, 0) > 0)
    );

  ELSIF p.role = 'umpire' THEN
    -- Ruling 11 Oct 2026: umpires have no Career section; appointments = 20.
    RETURN jsonb_build_array(
      jsonb_build_object('key', 'photo',      'weight', 10, 'done', COALESCE(length(btrim(p.avatar_url)), 0) > 0),
      jsonb_build_object('key', 'bio',        'weight', 10, 'done', COALESCE(length(btrim(p.bio)), 0) > 0),
      jsonb_build_object('key', 'nationality_base', 'weight', 10, 'done',
        (p.nationality_country_id IS NOT NULL OR COALESCE(length(btrim(p.nationality)), 0) > 0)
        AND COALESCE(length(btrim(p.base_location)), 0) > 0),
      jsonb_build_object('key', 'level',      'weight', 10, 'done',
        COALESCE(length(btrim(p.umpire_level)), 0) > 0 OR COALESCE(array_length(p.umpiring_categories, 1), 0) > 0),
      jsonb_build_object('key', 'federation', 'weight', 5,  'done', COALESCE(length(btrim(p.federation)), 0) > 0),
      jsonb_build_object('key', 'specialization', 'weight', 5, 'done', COALESCE(length(btrim(p.officiating_specialization)), 0) > 0),
      jsonb_build_object('key', 'gallery',    'weight', 5,  'done', COALESCE(p.gallery_photo_count, 0) > 0),
      jsonb_build_object('key', 'friends',    'weight', 5,  'done', COALESCE(p.accepted_friend_count, 0) > 0),
      jsonb_build_object('key', 'references', 'weight', 15, 'done', COALESCE(p.accepted_reference_count, 0) > 0),
      jsonb_build_object('key', 'available',  'weight', 5,  'done', p.available_for_appointments IS TRUE),
      jsonb_build_object('key', 'appointments', 'weight', 20, 'done', COALESCE(p.umpire_appointment_count, 0) > 0)
    );

  ELSIF p.role = 'brand' THEN
    SELECT br.logo_url, br.bio, br.website_url, br.instagram_url, br.country_id,
           COALESCE(br.ambassador_count, 0) AS ambassador_count
      INTO b
      FROM public.brands br
     WHERE br.profile_id = p.id AND br.deleted_at IS NULL
     LIMIT 1;
    v_has_brand := FOUND;
    RETURN jsonb_build_array(
      jsonb_build_object('key', 'logo',        'weight', 20, 'done', v_has_brand AND COALESCE(length(btrim(b.logo_url)), 0) > 0),
      jsonb_build_object('key', 'bio',         'weight', 20, 'done', v_has_brand AND COALESCE(length(btrim(b.bio)), 0) > 0),
      jsonb_build_object('key', 'links',       'weight', 20, 'done', v_has_brand AND
        (COALESCE(length(btrim(b.website_url)), 0) > 0 OR COALESCE(length(btrim(b.instagram_url)), 0) > 0)),
      jsonb_build_object('key', 'country',     'weight', 20, 'done', v_has_brand AND b.country_id IS NOT NULL),
      jsonb_build_object('key', 'ambassadors', 'weight', 20, 'done', v_has_brand AND b.ambassador_count > 0)
    );
  END IF;

  RETURN '[]'::jsonb;
END;
$$;

COMMENT ON FUNCTION public.profile_completeness_parts(public.profiles) IS
  'Profile v2: per-role completeness checklist [{key, weight, done, bonus?}]. compute_profile_completeness_pct '
  'is its sum (capped at 100). Player parts come from player_completeness_parts().';

REVOKE ALL ON FUNCTION public.profile_completeness_parts(public.profiles) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_completeness_parts(public.profiles) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_profile_completeness_pct(p public.profiles)
RETURNS SMALLINT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_score INTEGER := 0;
BEGIN
  IF p.role IS NULL THEN
    RETURN 0;
  END IF;
  SELECT COALESCE(sum((x->>'weight')::int) FILTER (WHERE (x->>'done')::boolean), 0)
    INTO v_score
    FROM jsonb_array_elements(public.profile_completeness_parts(p)) AS x;
  RETURN LEAST(GREATEST(v_score, 0), 100);
END;
$$;

COMMENT ON FUNCTION public.compute_profile_completeness_pct(public.profiles) IS
  'Canonical per-role completeness (0-100) = sum of profile_completeness_parts() (Profile v2, 2026-10-12).';

CREATE OR REPLACE FUNCTION public.get_my_profile_completeness()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'pct', public.compute_profile_completeness_pct(p),
           'parts', public.profile_completeness_parts(p))
    FROM public.profiles p
   WHERE p.id = (SELECT auth.uid())
$$;

REVOKE ALL ON FUNCTION public.get_my_profile_completeness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_completeness() TO authenticated;

-- Only umpire scores change (career weight moved to appointments). Backfill
-- them with every profiles UPDATE trigger disabled (incident 2026-08-28),
-- restoring each trigger's exact state; a no-op when there are no umpires.
DO $backfill$
DECLARE
  r       record;
  v_saved jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.role = 'umpire'
       AND p.profile_completeness_pct IS DISTINCT FROM public.compute_profile_completeness_pct(p)
  ) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT t.tgname, t.tgenabled
      FROM pg_trigger t
     WHERE t.tgrelid = 'public.profiles'::regclass
       AND NOT t.tgisinternal
       AND (t.tgtype & 16) <> 0
       AND t.tgenabled <> 'D'
  LOOP
    v_saved := v_saved || jsonb_build_object('name', r.tgname, 'state', r.tgenabled::text);
    EXECUTE format('ALTER TABLE public.profiles DISABLE TRIGGER %I', r.tgname);
  END LOOP;

  UPDATE public.profiles p
     SET profile_completeness_pct = public.compute_profile_completeness_pct(p)
   WHERE p.role = 'umpire'
     AND p.profile_completeness_pct IS DISTINCT FROM public.compute_profile_completeness_pct(p);

  FOR r IN SELECT x->>'name' AS name, x->>'state' AS state FROM jsonb_array_elements(v_saved) x LOOP
    EXECUTE format('ALTER TABLE public.profiles %s TRIGGER %I',
      CASE r.state WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'ENABLE' END, r.name);
  END LOOP;
END
$backfill$;

-- ── 2. Squad / members: Community fences ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_club_members(p_profile_id uuid, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, full_name text, avatar_url text, role text, nationality text, nationality_country_id integer,
              nationality2_country_id integer, base_location text, "position" text, secondary_position text,
              current_club text, current_world_club_id uuid, created_at timestamp with time zone,
              open_to_play boolean, open_to_coach boolean, is_test_account boolean, is_roster_member boolean,
              club_member_id uuid, total_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH club_ids AS (
    SELECT wc.id AS world_club_id FROM world_clubs wc WHERE wc.claimed_profile_id = p_profile_id
  ),
  roster AS (
    SELECT cm.member_profile_id AS pid, cm.id AS club_member_id
    FROM club_members cm WHERE cm.club_profile_id = p_profile_id AND cm.status = 'active'
  ),
  members AS (
    SELECT p.id AS pid, (r.pid IS NOT NULL) AS is_roster, r.club_member_id
    FROM profiles p
    LEFT JOIN roster r ON r.pid = p.id
    WHERE p.role IN ('player', 'coach')
      AND p.onboarding_completed = true
      -- Profile v2: the same discovery fence as Community (hidden, frozen
      -- minor, or DOB-grace lapsed) …
      AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
      -- … and never anyone in a block relationship with the viewer, either side.
      AND (auth.uid() IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.user_blocks ub
             WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = p.id)
                OR (ub.blocker_id = p.id AND ub.blocked_id = auth.uid())))
      AND (
        p.current_world_club_id IN (SELECT world_club_id FROM club_ids)
        OR r.pid IS NOT NULL
      )
  ),
  counted AS (SELECT COUNT(*) AS cnt FROM members)
  SELECT
    p.id, p.full_name, p.avatar_url, p.role::text, p.nationality, p.nationality_country_id,
    p.nationality2_country_id, p.base_location, p.position, p.secondary_position, p.current_club,
    p.current_world_club_id, p.created_at, p.open_to_play, p.open_to_coach, p.is_test_account,
    m.is_roster, m.club_member_id, c.cnt
  FROM members m
  JOIN profiles p ON p.id = m.pid
  CROSS JOIN counted c
  ORDER BY p.full_name ASC
  LIMIT p_limit
  OFFSET p_offset;
$function$;

-- ── 3. Brand cover + open to partners ─────────────────────────────────────
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS open_to_partners boolean NOT NULL DEFAULT false;
ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_cover_url_length;
ALTER TABLE public.brands ADD CONSTRAINT brands_cover_url_length CHECK (cover_url IS NULL OR char_length(cover_url) <= 1000);
COMMENT ON COLUMN public.brands.cover_url IS 'Profile v2 hero photo (restored 2026-10-12). Covers under 600 px wide are ignored by the client.';
COMMENT ON COLUMN public.brands.open_to_partners IS 'Profile v2: the brand looks for ambassadors ("Looking for ambassadors" chip + Community filter).';

-- ── 4. Product click-outs: the brand's own aggregates only ────────────────
CREATE OR REPLACE FUNCTION public.get_my_product_tap_stats(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 7), 1), 90);
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'products', '[]'::jsonb, 'days', v_days);
  END IF;

  WITH mine AS (
    SELECT bp.id
      FROM public.brand_products bp
      JOIN public.brands br ON br.id = bp.brand_id
     WHERE br.profile_id = v_uid AND br.deleted_at IS NULL AND bp.deleted_at IS NULL
  ),
  taps AS (
    -- analytics_events: bots and test accounts already excluded. One tap per
    -- viewer per product per day; the brand's own taps never count.
    SELECT DISTINCT e.entity_id AS product_id,
           COALESCE(e.user_id::text, e.anonymous_id, e.session_id, e.ip_hash) AS viewer,
           (e.created_at AT TIME ZONE 'utc')::date AS day
      FROM public.analytics_events e
     WHERE e.event_name = 'brand_product_click'
       AND e.entity_type = 'brand_product'
       AND e.entity_id IN (SELECT id FROM mine)
       AND e.created_at >= timezone('utc', now()) - make_interval(days => v_days)
       AND e.user_id IS DISTINCT FROM v_uid
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM taps),
           'products', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('product_id', m.id, 'taps', COALESCE(t.n, 0)))
               FROM mine m
               LEFT JOIN (SELECT product_id, count(*) AS n FROM taps GROUP BY product_id) t ON t.product_id = m.id
           ), '[]'::jsonb),
           'days', v_days)
    INTO v_result;
  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_my_product_tap_stats(integer) IS
  'Profile v2: taps on the caller''s own brand products'' external links (deduped per viewer/product/day, '
  'bots/test/self excluded). Aggregates only — never who tapped.';

REVOKE ALL ON FUNCTION public.get_my_product_tap_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_product_tap_stats(integer) TO authenticated, service_role;
