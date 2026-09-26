-- =========================================================================
-- D2 · 30-second profile — slice 1 · completeness counts the key facts
-- =========================================================================
-- Founder ruling 2026-09-26: "Complete profiles are suggested to clubs more
-- often" must be true. The player score now counts what clubs check first:
-- league, passport, uploaded video, availability — and a valid visa / permit.
-- The legacy highlight_video_url link no longer carries weight; uploaded
-- videos do (player_videos highlight / full_match that are ready, and
-- player_full_game_videos via the existing full_game_video_count).
--
-- Player weights (sum 100, plus a +5 bonus for a valid permit, capped at 100
-- so a player without any permit can still reach 100):
--   photo 10 · position 5 · current club 5 · league 10 (club league OR
--   self-reported: completeness is about filling the gap, NOT level) ·
--   passport 10 · base location 5 · video 20 · open to play 5 ·
--   availability date or length 5 · bio 5 · career 10 · references 10
--   · valid visa/permit +5 (bonus)
-- Coach, club, umpire and brand formulas are unchanged.
--
-- The score is still computed by the BEFORE trigger on profiles, which runs
-- as the caller: the only direct (non-DEFINER) writers of a profile row are
-- its owner, who sees all of their own videos and permits through RLS.
-- Changes to player_videos / player_work_permits recompute the owner's score
-- through DEFINER maintenance triggers, as gallery / brands already do.
--
-- BACKFILL (step 5) is a mass UPDATE on public.profiles. Every UPDATE trigger
-- on profiles is disabled around it and re-enabled with its previous state in
-- the same transaction (incident 2026-08-28: a batch UPDATE rewrote 301
-- updated_at values). UPDATE triggers on profiles, staging = production
-- 2026-09-26, all enabled ('O'):
--   BEFORE: check_profile_concurrent_update, enforce_availability_consistency_trigger,
--           prevent_profile_role_change, profiles_onboarding_timestamp,
--           profiles_version_trigger (bumps version), set_profiles_updated_at
--           (bumps updated_at), sync_profile_leagues_to_world_trigger,
--           trg_profiles_search_vector, trg_profiles_set_completeness_pct,
--           trigger_guard_dob_direct_write, trg_guard_open_to_play_minor (new, 20260928210000)
--   AFTER:  profiles_invalidate_ai_opinions, trg_profiles_full_match_visibility_cascade,
--           trg_sync_profile_avatar_to_world, trg_video_delete_milestone,
--           trigger_celebrate_first_highlight_video, trigger_celebrate_first_world_club_link,
--           trigger_guard_dob_direct_write_effects, trigger_member_joined_feed,
--           trigger_open_to_play_confirmed_feed, trigger_profile_completion_milestone
--           (records milestones / feed items), trigger_sync_profile_feed_metadata
-- The DO block disables whatever UPDATE triggers exist at apply time (so a
-- trigger added later is covered too), sets only profile_completeness_pct on
-- rows whose value changes, then restores each trigger's exact enabled state.
-- ONE-TIME RANKING CHANGE: community / discover order by this score.
-- =========================================================================

-- ── 1. The player parts (one source of truth for score + owner checklist) ─
CREATE OR REPLACE FUNCTION public.player_completeness_parts(p public.profiles)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_club_league boolean := false;
  v_has_video   boolean;
  v_has_permit  boolean;
BEGIN
  IF p.current_world_club_id IS NOT NULL THEN
    SELECT (wc.men_league_id IS NOT NULL OR wc.women_league_id IS NOT NULL)
      INTO v_club_league
      FROM public.world_clubs wc
     WHERE wc.id = p.current_world_club_id;
  END IF;

  v_has_video := COALESCE(p.full_game_video_count, 0) > 0
    OR EXISTS (SELECT 1 FROM public.player_videos v
                WHERE v.user_id = p.id
                  AND v.kind IN ('highlight', 'full_match')
                  AND v.status = 'ready');

  v_has_permit := EXISTS (SELECT 1 FROM public.player_work_permits w
                           WHERE w.player_id = p.id
                             AND public.work_permit_status(w.valid_from, w.expires_on) IN ('valid', 'expiring_soon'));

  RETURN jsonb_build_array(
    jsonb_build_object('key', 'photo',        'weight', 10, 'done', COALESCE(length(btrim(p.avatar_url)), 0) > 0),
    jsonb_build_object('key', 'position',     'weight', 5,  'done', COALESCE(length(btrim(p.position)), 0) > 0),
    jsonb_build_object('key', 'current_club', 'weight', 5,  'done', p.current_world_club_id IS NOT NULL OR COALESCE(length(btrim(p.current_club)), 0) > 0),
    jsonb_build_object('key', 'league',       'weight', 10, 'done', COALESCE(v_club_league, false) OR p.mens_league_id IS NOT NULL OR p.womens_league_id IS NOT NULL),
    jsonb_build_object('key', 'passport',     'weight', 10, 'done', p.nationality_country_id IS NOT NULL OR p.nationality2_country_id IS NOT NULL),
    jsonb_build_object('key', 'base_location','weight', 5,  'done', COALESCE(length(btrim(p.base_location)), 0) > 0),
    jsonb_build_object('key', 'video',        'weight', 20, 'done', v_has_video),
    jsonb_build_object('key', 'open_to_play', 'weight', 5,  'done', p.open_to_play IS TRUE),
    jsonb_build_object('key', 'availability', 'weight', 5,  'done', p.available_from IS NOT NULL OR p.availability_duration IS NOT NULL),
    jsonb_build_object('key', 'bio',          'weight', 5,  'done', COALESCE(length(btrim(p.bio)), 0) > 0),
    jsonb_build_object('key', 'career',       'weight', 10, 'done', COALESCE(p.career_entry_count, 0) > 0),
    jsonb_build_object('key', 'references',   'weight', 10, 'done', COALESCE(p.accepted_reference_count, 0) > 0),
    jsonb_build_object('key', 'work_permit',  'weight', 5,  'done', v_has_permit, 'bonus', true)
  );
END;
$$;

COMMENT ON FUNCTION public.player_completeness_parts(public.profiles) IS
  'D2: player completeness checklist [{key, weight, done, bonus?}]. compute_profile_completeness_pct '
  'sums it (capped at 100). Reads player_videos / player_work_permits under the caller''s RLS.';

-- Runs inside the profiles BEFORE trigger as the writing user, so the roles
-- that write profiles need EXECUTE. It only reads what the caller can already see.
REVOKE ALL ON FUNCTION public.player_completeness_parts(public.profiles) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.player_completeness_parts(public.profiles) TO authenticated, service_role;

-- ── 2. Canonical score: player branch re-weighted, the rest unchanged ─────
CREATE OR REPLACE FUNCTION public.compute_profile_completeness_pct(p public.profiles)
RETURNS SMALLINT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_score INTEGER := 0;
  b RECORD;
BEGIN
  IF p.role IS NULL THEN
    RETURN 0;
  END IF;

  IF p.role = 'player' THEN
    -- D2 (2026-09-26): the player score is the sum of player_completeness_parts()
    -- — the key facts clubs read first carry most of the weight.
    SELECT COALESCE(sum((x->>'weight')::int) FILTER (WHERE (x->>'done')::boolean), 0)
      INTO v_score
      FROM jsonb_array_elements(public.player_completeness_parts(p)) AS x;

  ELSIF p.role = 'coach' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.coaching_categories IS NOT NULL AND array_length(p.coaching_categories, 1) > 0)
       OR (p.coach_specialization IS NOT NULL AND length(btrim(p.coach_specialization)) > 0) THEN v_score := v_score + 10; END IF;
    IF p.current_club IS NOT NULL AND length(btrim(p.current_club)) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF COALESCE(p.gallery_photo_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF p.open_to_coach = TRUE THEN v_score := v_score + 10; END IF;

  ELSIF p.role = 'club' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 15; END IF;
    IF (p.club_bio IS NOT NULL AND length(btrim(p.club_bio)) > 0)
       OR (p.bio IS NOT NULL AND length(btrim(p.bio)) > 0) THEN v_score := v_score + 20; END IF;
    IF p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.nationality_country_id IS NOT NULL THEN v_score := v_score + 5; END IF;
    IF p.year_founded IS NOT NULL THEN v_score := v_score + 10; END IF;
    IF (p.contact_email IS NOT NULL AND length(btrim(p.contact_email)) > 0 AND p.contact_email_public = TRUE)
       OR (p.website IS NOT NULL AND length(btrim(p.website)) > 0) THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.club_media_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF COALESCE(p.post_count, 0) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;

  ELSIF p.role = 'umpire' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.umpire_level IS NOT NULL AND length(btrim(p.umpire_level)) > 0)
       OR (p.umpiring_categories IS NOT NULL AND array_length(p.umpiring_categories, 1) > 0) THEN v_score := v_score + 10; END IF;
    IF p.federation IS NOT NULL AND length(btrim(p.federation)) > 0 THEN v_score := v_score + 5; END IF;
    IF p.officiating_specialization IS NOT NULL AND length(btrim(p.officiating_specialization)) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.gallery_photo_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF p.available_for_appointments = TRUE THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.umpire_appointment_count, 0) > 0 THEN v_score := v_score + 10; END IF;

  ELSIF p.role = 'brand' THEN
    -- Brand identity lives in the brands table (the brand owner edits it
    -- there), NOT on profiles. Read the active brand row.
    -- Only real brands columns (product_count lives in a view, not the table).
    SELECT br.logo_url, br.bio, br.website_url, br.instagram_url, br.country_id,
           COALESCE(br.ambassador_count, 0) AS ambassador_count
      INTO b
      FROM public.brands br
      WHERE br.profile_id = p.id AND br.deleted_at IS NULL
      LIMIT 1;
    IF FOUND THEN
      IF b.logo_url IS NOT NULL AND length(btrim(b.logo_url)) > 0 THEN v_score := v_score + 20; END IF;
      IF b.bio IS NOT NULL AND length(btrim(b.bio)) > 0 THEN v_score := v_score + 20; END IF;
      IF (b.website_url IS NOT NULL AND length(btrim(b.website_url)) > 0)
         OR (b.instagram_url IS NOT NULL AND length(btrim(b.instagram_url)) > 0) THEN v_score := v_score + 20; END IF;
      IF b.country_id IS NOT NULL THEN v_score := v_score + 20; END IF;
      IF b.ambassador_count > 0 THEN v_score := v_score + 20; END IF;
    END IF;
  END IF;

  IF v_score < 0 THEN v_score := 0; END IF;
  IF v_score > 100 THEN v_score := 100; END IF;
  RETURN v_score;
END;
$$;

COMMENT ON FUNCTION public.compute_profile_completeness_pct(public.profiles) IS
  'Canonical per-role completeness (0-100). Player = sum of player_completeness_parts() (D2, 2026-09-26); '
  'other roles read the profiles row (incl. denormalised counts) and, for brand, the brands table.';

-- ── 3. Maintenance: video and permit changes recompute the owner's score ──
-- Only rows whose score actually changes are written (then the profile's own
-- triggers run as for any profile edit of that one person).
CREATE OR REPLACE FUNCTION public.sync_completeness_from_player_videos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  UPDATE public.profiles pr
     SET profile_completeness_pct = public.compute_profile_completeness_pct(pr)
   WHERE pr.id = v_uid
     AND pr.role = 'player'
     AND pr.profile_completeness_pct IS DISTINCT FROM public.compute_profile_completeness_pct(pr);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_completeness_from_work_permits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := COALESCE(NEW.player_id, OLD.player_id);
BEGIN
  UPDATE public.profiles pr
     SET profile_completeness_pct = public.compute_profile_completeness_pct(pr)
   WHERE pr.id = v_uid
     AND pr.role = 'player'
     AND pr.profile_completeness_pct IS DISTINCT FROM public.compute_profile_completeness_pct(pr);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_completeness_from_player_videos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_completeness_from_work_permits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_completeness_from_player_videos() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_completeness_from_work_permits() TO service_role;

DROP TRIGGER IF EXISTS trg_player_videos_sync_completeness ON public.player_videos;
CREATE TRIGGER trg_player_videos_sync_completeness
  AFTER INSERT OR DELETE OR UPDATE OF status, kind ON public.player_videos
  FOR EACH ROW EXECUTE FUNCTION public.sync_completeness_from_player_videos();

DROP TRIGGER IF EXISTS trg_player_work_permits_sync_completeness ON public.player_work_permits;
CREATE TRIGGER trg_player_work_permits_sync_completeness
  AFTER INSERT OR DELETE OR UPDATE ON public.player_work_permits
  FOR EACH ROW EXECUTE FUNCTION public.sync_completeness_from_work_permits();

-- ── 4. Owner read: the checklist behind "Complete profiles are suggested more often"
CREATE OR REPLACE FUNCTION public.get_my_profile_completeness()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'pct', public.compute_profile_completeness_pct(p),
           'parts', CASE WHEN p.role = 'player' THEN public.player_completeness_parts(p) ELSE NULL END)
    FROM public.profiles p
   WHERE p.id = (SELECT auth.uid())
$$;

REVOKE ALL ON FUNCTION public.get_my_profile_completeness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile_completeness() TO authenticated;

-- ── 5. Backfill with every profiles UPDATE trigger disabled ───────────────
DO $backfill$
DECLARE
  r        record;
  v_saved  jsonb := '[]'::jsonb;
  v_rows   integer;
BEGIN
  -- tgtype bit 16 = fires on UPDATE. Internal (FK / constraint) triggers are left alone.
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
   WHERE p.profile_completeness_pct IS DISTINCT FROM public.compute_profile_completeness_pct(p);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  FOR r IN SELECT x->>'name' AS name, x->>'state' AS state FROM jsonb_array_elements(v_saved) x LOOP
    EXECUTE format('ALTER TABLE public.profiles %s TRIGGER %I',
      CASE r.state WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'ENABLE' END,
      r.name);
  END LOOP;

  RAISE NOTICE 'D2 completeness backfill: % rows re-scored, % UPDATE triggers paused and restored',
    v_rows, jsonb_array_length(v_saved);
END
$backfill$;
