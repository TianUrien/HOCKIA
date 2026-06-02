-- ─────────────────────────────────────────────────────────────────────
-- get_top_community_members — also return coach_specialization +
-- coaching_categories (Phase 2C polish)
-- ─────────────────────────────────────────────────────────────────────
-- The Community "Top members for your search" carousel renders a Club Fit
-- chip on player cards. Phase 2C added a Coach Fit chip on coach cards in
-- the grid, but the carousel's RPC didn't return the two fields the coach
-- model reads (coach_specialization + coaching_categories), so coach cards
-- in the carousel couldn't show the chip. This adds them.
--
-- Pure additive change: same body, WHERE, and ORDER BY as the prior
-- definition (20260528090000); only two columns are appended to the
-- RETURNS TABLE and the SELECT. Ranking is unchanged (the carousel is
-- server-sorted by p_sort; the chip is a label, not an order signal).

DROP FUNCTION IF EXISTS public.get_top_community_members(text, integer, text, boolean);

CREATE OR REPLACE FUNCTION public.get_top_community_members(
  p_role text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_sort text DEFAULT 'completeness',
  p_only_open boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  role text,
  full_name text,
  username text,
  avatar_url text,
  nationality text,
  nationality_country_id integer,
  nationality2_country_id integer,
  base_location text,
  "position" text,
  current_club text,
  current_world_club_id uuid,
  open_to_play boolean,
  open_to_coach boolean,
  open_to_opportunities boolean,
  is_verified boolean,
  last_active_at timestamp with time zone,
  profile_completeness_pct smallint,
  accepted_reference_count integer,
  accepted_friend_count integer,
  playing_category text,
  gender text,
  competition_level_band integer,
  current_competition_name text,
  coach_specialization text,
  coaching_categories text[]
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
    p.accepted_friend_count,
    p.playing_category::TEXT,
    p.gender::TEXT,
    -- Pick the gender-appropriate league band, fall back to whichever
    -- exists. Null when player has no current_world_club_id or the
    -- club has neither league linked.
    CASE
      WHEN p.playing_category IN ('adult_men', 'boys') THEN
        COALESCE(wl_m.level_band_global, wl_w.level_band_global)
      WHEN p.playing_category IN ('adult_women', 'girls') THEN
        COALESCE(wl_w.level_band_global, wl_m.level_band_global)
      ELSE
        COALESCE(wl_w.level_band_global, wl_m.level_band_global)
    END AS competition_level_band,
    -- Display name of the player's current league. Same gender pick.
    CASE
      WHEN p.playing_category IN ('adult_men', 'boys') THEN
        COALESCE(wl_m.name, wl_w.name)
      WHEN p.playing_category IN ('adult_women', 'girls') THEN
        COALESCE(wl_w.name, wl_m.name)
      ELSE
        COALESCE(wl_w.name, wl_m.name)
    END AS current_competition_name,
    -- Phase 2C — coach fit fields. Carry the coach's specialization +
    -- coaching categories so the carousel can render the Coach Fit chip
    -- on coach cards (null for non-coach rows).
    p.coach_specialization::TEXT,
    p.coaching_categories
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

-- DROP wiped the prior grants; re-establish them (anon + authenticated
-- both call this for the public Community carousel).
GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) TO anon;
