-- ─────────────────────────────────────────────────────────────────────
-- get_top_community_members — project the remaining role-specific Preview
-- fields (umpire / coach / club) so a member opened from the Top carousel
-- shows the same detail as one opened from the All Members grid.
--
-- Audit follow-up (Medium remnant of the carousel↔grid parity cluster):
-- carousel-sourced umpire previews showed "No details yet" and coach/club
-- detail was missing because the RPC didn't project these plain profiles
-- columns. (Brand fields live in the `brands` table and are enriched
-- client-side, mirroring PeopleListView — not here.)
--
-- DROP + recreate + re-grant (RETURNS TABLE signature change). Body verbatim
-- from 20260615220000 + the six new projections.
-- ─────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_top_community_members(text, integer, text, boolean);

CREATE OR REPLACE FUNCTION public.get_top_community_members(
  p_role text DEFAULT NULL::text,
  p_limit integer DEFAULT 20,
  p_sort text DEFAULT 'completeness'::text,
  p_only_open boolean DEFAULT false
)
RETURNS TABLE(
  id uuid, role text, full_name text, username text, avatar_url text,
  nationality text, nationality_country_id integer, nationality2_country_id integer,
  base_location text, "position" text, current_club text, current_world_club_id uuid,
  open_to_play boolean, open_to_coach boolean, open_to_opportunities boolean,
  is_verified boolean, last_active_at timestamp with time zone,
  profile_completeness_pct smallint, accepted_reference_count integer,
  career_entry_count integer,
  accepted_friend_count integer, playing_category text, gender text,
  competition_level_band integer, current_competition_name text,
  coach_specialization text, coaching_categories text[],
  highlight_video_url text, full_game_video_count integer,
  relocation_willingness text, relocation_countries_open integer[],
  relocation_countries_excluded integer[], available_from date, base_country_id integer,
  level_target text, opportunity_preference text,
  available_for_appointments boolean,
  bio text, umpire_level text, federation text, year_founded integer,
  secondary_position text, specialist_skills text[], umpiring_categories text[],
  verified_at timestamp with time zone,
  -- Role-specific Preview parity (umpire / coach / club)
  umpire_since smallint, officiating_specialization text, languages text[],
  last_officiated_at date, coach_specialization_custom text, club_bio text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.role::TEXT,
    p.full_name,
    p.username,
    p.avatar_url,
    p.nationality,
    p.nationality_country_id,
    p.nationality2_country_id,
    p.base_location,
    p.position,
    p.current_club,
    p.current_world_club_id::UUID,
    p.open_to_play,
    p.open_to_coach,
    p.open_to_opportunities,
    p.is_verified,
    p.last_active_at,
    p.profile_completeness_pct,
    p.accepted_reference_count,
    p.career_entry_count,
    p.accepted_friend_count,
    p.playing_category::TEXT,
    p.gender::TEXT,
    CASE
      WHEN p.playing_category IN ('adult_men', 'boys') THEN
        COALESCE(wl_m.level_band_global, wl_w.level_band_global)
      WHEN p.playing_category IN ('adult_women', 'girls') THEN
        COALESCE(wl_w.level_band_global, wl_m.level_band_global)
      ELSE
        COALESCE(wl_w.level_band_global, wl_m.level_band_global)
    END AS competition_level_band,
    CASE
      WHEN p.playing_category IN ('adult_men', 'boys') THEN
        COALESCE(wl_m.name, wl_w.name)
      WHEN p.playing_category IN ('adult_women', 'girls') THEN
        COALESCE(wl_w.name, wl_m.name)
      ELSE
        COALESCE(wl_w.name, wl_m.name)
    END AS current_competition_name,
    p.coach_specialization::TEXT,
    p.coaching_categories,
    p.highlight_video_url,
    p.full_game_video_count,
    p.relocation_willingness,
    p.relocation_countries_open,
    p.relocation_countries_excluded,
    p.available_from,
    p.base_country_id,
    p.level_target,
    p.opportunity_preference,
    p.available_for_appointments,
    p.bio,
    p.umpire_level,
    p.federation,
    p.year_founded,
    p.secondary_position,
    p.specialist_skills,
    p.umpiring_categories,
    p.verified_at,
    -- Role-specific Preview parity
    p.umpire_since,
    p.officiating_specialization,
    p.languages,
    p.last_officiated_at,
    p.coach_specialization_custom,
    p.club_bio
  FROM public.profiles p
  LEFT JOIN public.world_clubs wc ON wc.id = p.current_world_club_id
  LEFT JOIN public.world_leagues wl_m ON wl_m.id = wc.men_league_id
  LEFT JOIN public.world_leagues wl_w ON wl_w.id = wc.women_league_id
  WHERE p.onboarding_completed = TRUE
    AND COALESCE(p.is_blocked, FALSE) = FALSE
    AND COALESCE(p.is_test_account, FALSE) = FALSE
    AND (p_role IS NULL OR p.role = p_role)
    AND (p_role IS NOT NULL OR p.role <> 'brand')
    AND (
      NOT p_only_open
      OR COALESCE(p.open_to_play, FALSE)
      OR COALESCE(p.open_to_coach, FALSE)
      OR COALESCE(p.open_to_opportunities, FALSE)
      OR COALESCE(p.available_for_appointments, FALSE)
    )
  ORDER BY
    CASE WHEN p_sort = 'availability_activity' THEN
      (COALESCE(p.open_to_play, FALSE)
        OR COALESCE(p.open_to_coach, FALSE)
        OR COALESCE(p.open_to_opportunities, FALSE)
        OR COALESCE(p.available_for_appointments, FALSE))::int
    ELSE 0 END DESC,
    CASE WHEN p_sort = 'availability_activity' THEN p.last_active_at END
      DESC NULLS LAST,
    CASE WHEN p_sort = 'recently_joined' THEN p.created_at END
      DESC NULLS LAST,
    p.profile_completeness_pct DESC,
    p.last_active_at DESC NULLS LAST,
    (p.avatar_url IS NOT NULL) DESC,
    (p.current_club IS NOT NULL) DESC,
    (COALESCE(p.accepted_reference_count, 0) > 0) DESC,
    (COALESCE(p.open_to_play, FALSE)
      OR COALESCE(p.open_to_coach, FALSE)
      OR COALESCE(p.open_to_opportunities, FALSE)
      OR COALESCE(p.available_for_appointments, FALSE)) DESC,
    p.id
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$function$;

GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) TO anon;
