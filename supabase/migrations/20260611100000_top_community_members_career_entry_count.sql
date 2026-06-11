-- ─────────────────────────────────────────────────────────────────────
-- get_top_community_members — also project career_entry_count
-- ─────────────────────────────────────────────────────────────────────
-- The RPC already reads career_entry_count internally for the per-role
-- completeness score, but its RETURNS TABLE / SELECT projection omitted it
-- (accepted_reference_count was projected; career_entry_count was not).
--
-- Downstream, carousel rows are mapped (topRowToProfile) into the recruiter
-- Preview (CandidatePreviewSheet) + MemberPreviewModal, whose
-- evidenceChecklist()'s 'career' row reads candidate.career_entry_count.
-- With the field absent it always rendered "Career history: MISSING" for
-- carousel-sourced candidates — even members with real journey entries
-- (e.g. Valentina Turienzo, career_entry_count = 6). This brings the
-- journey signal to parity with accepted_reference_count.
--
-- career_entry_count is already an anon-selectable count column on profiles
-- (20260518100000_grant_anon_select_profile_count_columns), and is already
-- shown on the public profile — no new data is exposed.
--
-- Adding a column to RETURNS TABLE changes the signature → DROP + recreate
-- and re-grant (anon + authenticated; the carousel is public-facing).
-- Body is otherwise verbatim from 20260605100000.

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
  level_target text, opportunity_preference text
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
    -- Phase 2C — coach fit fields (null for non-coach rows).
    p.coach_specialization::TEXT,
    p.coaching_categories,
    -- Increment #1 — Proven lens video evidence.
    p.highlight_video_url,
    p.full_game_video_count,
    -- Increment #2.2 — Interested lens candidate intent (home country via
    -- base_country_id; nationality_country_id above is the fallback).
    p.relocation_willingness,
    p.relocation_countries_open,
    p.relocation_countries_excluded,
    p.available_from,
    p.base_country_id,
    -- Increment #4b — self-declared level + compensation intent.
    p.level_target,
    p.opportunity_preference
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
    )
  ORDER BY
    CASE WHEN p_sort = 'availability_activity' THEN
      (COALESCE(p.open_to_play, FALSE)
        OR COALESCE(p.open_to_coach, FALSE)
        OR COALESCE(p.open_to_opportunities, FALSE))::int
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
      OR COALESCE(p.open_to_opportunities, FALSE)) DESC,
    p.id
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$function$;

GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) TO anon;
