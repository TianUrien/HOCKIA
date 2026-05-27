-- ─────────────────────────────────────────────────────────────────────
-- get_top_community_members — return competition_level_band
-- ─────────────────────────────────────────────────────────────────────
-- P1.2 follow-up: surface the curated level_band_global value for
-- each member's club so Club Fit's competition_proximity component
-- can compute non-zero proximity for the first time.
--
-- Derivation: profiles.current_world_club_id → world_clubs →
-- (men_league_id if player is men/boys, women_league_id if women/girls)
-- → world_leagues.level_band_global. For 'mixed' / null categories
-- we COALESCE women first then men — the choice is arbitrary at the
-- candidate side because the viewer's target_category decides the
-- comparison band; this just gives us *something* to compare against.
--
-- The proximity formula `1 - clamp(|pg - cg| / 4, 0, 1)` then runs
-- in the client (per Sprint v1 Club Fit math) using this column +
-- the viewer's own derived band.

-- Postgres requires DROP before changing RETURNS shape on a function.
-- Existing callers (TopCommunityMembersCarousel) re-run their RPCs on
-- next render; no downtime risk because the RPC is recreated atomically
-- in the same transaction.
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
  competition_level_band integer
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
    END AS competition_level_band
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
