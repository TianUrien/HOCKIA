-- Rollback for 20261012100000_profile_v2_backend.sql.
DROP FUNCTION IF EXISTS public.get_my_product_tap_stats(integer);
ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_cover_url_length;
ALTER TABLE public.brands DROP COLUMN IF EXISTS open_to_partners;
ALTER TABLE public.brands DROP COLUMN IF EXISTS cover_url;

-- Restore the D2 (20260928220000) completeness functions.
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

DROP FUNCTION IF EXISTS public.profile_completeness_parts(public.profiles);

-- get_club_members: back to the hidden-only fence (pre-Profile v2 body).
CREATE OR REPLACE FUNCTION public.get_club_members(p_profile_id uuid, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
RETURNS TABLE(id uuid, full_name text, avatar_url text, role text, nationality text, nationality_country_id integer,
              nationality2_country_id integer, base_location text, "position" text, secondary_position text,
              current_club text, current_world_club_id uuid, created_at timestamp with time zone,
              open_to_play boolean, open_to_coach boolean, is_test_account boolean, is_roster_member boolean,
              club_member_id uuid, total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH club_ids AS (SELECT wc.id AS world_club_id FROM world_clubs wc WHERE wc.claimed_profile_id = p_profile_id),
  roster AS (SELECT cm.member_profile_id AS pid, cm.id AS club_member_id FROM club_members cm WHERE cm.club_profile_id = p_profile_id AND cm.status = 'active'),
  members AS (
    SELECT p.id AS pid, (r.pid IS NOT NULL) AS is_roster, r.club_member_id
    FROM profiles p LEFT JOIN roster r ON r.pid = p.id
    WHERE p.role IN ('player', 'coach') AND p.onboarding_completed = true
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      AND (p.current_world_club_id IN (SELECT world_club_id FROM club_ids) OR r.pid IS NOT NULL)
  ),
  counted AS (SELECT COUNT(*) AS cnt FROM members)
  SELECT p.id, p.full_name, p.avatar_url, p.role::text, p.nationality, p.nationality_country_id, p.nationality2_country_id,
         p.base_location, p.position, p.secondary_position, p.current_club, p.current_world_club_id, p.created_at,
         p.open_to_play, p.open_to_coach, p.is_test_account, m.is_roster, m.club_member_id, c.cnt
  FROM members m JOIN profiles p ON p.id = m.pid CROSS JOIN counted c
  ORDER BY p.full_name ASC LIMIT p_limit OFFSET p_offset;
$function$;
-- Umpire scores are recomputed by the next profile write (no mass UPDATE in a rollback).
