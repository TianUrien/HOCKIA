-- ─────────────────────────────────────────────────────────────────────
-- get_top_community_members — weekly-theme support
-- ─────────────────────────────────────────────────────────────────────
-- Phase 1 / Carousel weekly-theme rotation (2026-05-27).
--
-- Extends the RPC with the criteria the rotating Featured carousel
-- needs beyond the existing 'completeness' / 'availability_activity'
-- pair:
--
--   - p_sort = 'recently_joined' — order by created_at DESC, surfacing
--     new HOCKIA members. Used by the "New on HOCKIA" theme.
--
--   - p_only_open BOOLEAN (default FALSE) — when TRUE, filter the
--     result set to profiles that have at least one open-to-X flag
--     set. Used by the "Open to opportunities" theme so the carousel
--     only shows profiles currently accepting recruitment contact.
--
-- The 'completeness' (default) and 'availability_activity' sorts
-- continue to work exactly as before. The third 'recently_joined'
-- adds a CASE branch in the ORDER BY that pushes recency to the top
-- when selected; in the other branches the CASE returns NULL so the
-- existing universal tiebreakers handle ordering uniformly.
--
-- p_only_open is additive — it composes cleanly with any p_sort.
-- "Open to opportunities" theme uses (sort='availability_activity',
-- only_open=true). Future themes can mix freely.

BEGIN;

DROP FUNCTION IF EXISTS public.get_top_community_members(TEXT, INT, TEXT);
DROP FUNCTION IF EXISTS public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.get_top_community_members(
  p_role TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_sort TEXT DEFAULT 'completeness',
  p_only_open BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  role TEXT,
  full_name TEXT,
  username TEXT,
  avatar_url TEXT,
  nationality TEXT,
  nationality_country_id INTEGER,
  nationality2_country_id INTEGER,
  base_location TEXT,
  "position" TEXT,
  current_club TEXT,
  current_world_club_id UUID,
  open_to_play BOOLEAN,
  open_to_coach BOOLEAN,
  open_to_opportunities BOOLEAN,
  is_verified BOOLEAN,
  last_active_at TIMESTAMPTZ,
  profile_completeness_pct SMALLINT,
  accepted_reference_count INTEGER,
  accepted_friend_count INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    p.accepted_friend_count
  FROM public.profiles p
  WHERE p.onboarding_completed = TRUE
    AND COALESCE(p.is_blocked, FALSE) = FALSE
    AND COALESCE(p.is_test_account, FALSE) = FALSE
    AND (p_role IS NULL OR p.role = p_role)
    AND (p_role IS NOT NULL OR p.role <> 'brand')
    -- Open-only filter — opt-in via p_only_open. Used by the "Open
    -- to opportunities" theme so the carousel only shows profiles
    -- accepting recruitment contact right now.
    AND (
      NOT p_only_open
      OR COALESCE(p.open_to_play, FALSE)
      OR COALESCE(p.open_to_coach, FALSE)
      OR COALESCE(p.open_to_opportunities, FALSE)
    )
  ORDER BY
    -- 'availability_activity' primary: open status first.
    CASE WHEN p_sort = 'availability_activity' THEN
      (COALESCE(p.open_to_play, FALSE)
        OR COALESCE(p.open_to_coach, FALSE)
        OR COALESCE(p.open_to_opportunities, FALSE))::int
    ELSE 0 END DESC,
    -- 'availability_activity' secondary: last active.
    CASE WHEN p_sort = 'availability_activity' THEN p.last_active_at END
      DESC NULLS LAST,
    -- 'recently_joined' primary: created_at DESC. CASE returns NULL
    -- for other sorts so the universal tiebreakers kick in.
    CASE WHEN p_sort = 'recently_joined' THEN p.created_at END
      DESC NULLS LAST,
    -- 'completeness' primary; also a tiebreaker for other sorts.
    p.profile_completeness_pct DESC,
    -- Universal tiebreakers.
    p.last_active_at DESC NULLS LAST,
    (p.avatar_url IS NOT NULL) DESC,
    (p.current_club IS NOT NULL) DESC,
    (COALESCE(p.accepted_reference_count, 0) > 0) DESC,
    (COALESCE(p.open_to_play, FALSE)
      OR COALESCE(p.open_to_coach, FALSE)
      OR COALESCE(p.open_to_opportunities, FALSE)) DESC,
    p.id
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$$;

COMMENT ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) IS
  'Top N community profiles per role lane with rotating-theme support. p_sort: ''completeness'' (default) / ''availability_activity'' / ''recently_joined''. p_only_open: when true, filters to profiles with any open-to-X flag set. Optional role filter; caps at 100 rows.';

GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) TO anon;

COMMIT;
