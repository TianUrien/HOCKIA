-- ─────────────────────────────────────────────────────────────────────
-- get_top_community_members — role-aware ranking criterion
-- ─────────────────────────────────────────────────────────────────────
-- Phase 1 / Carousel Slice B (2026-05-27).
--
-- Adds a `p_sort` parameter to the existing RPC so the player lane on
-- the Community "Featured this week" carousel can be ranked by
-- availability + activity instead of profile_completeness_pct.
--
-- Why the change:
--   The original RPC ranks every role by profile_completeness_pct.
--   For clubs/coaches/umpires this is acceptable — those are
--   organizations or service profiles where "more complete = more
--   useful to a player". For players, ranking humans by a
--   data-entry score reads as a public quality judgment, which is
--   exactly what we want to avoid on player surfaces.
--
--   Solution: extend the RPC with a sort selector. The CommunityPage
--   passes 'availability_activity' for the player lane (favouring
--   open-to-play + recently-active) and 'completeness' (the default)
--   for the other lanes.
--
-- Why CASE-in-ORDER-BY (vs. PL/pgSQL with dynamic SQL):
--   Pure SQL function keeps STABLE / SECURITY INVOKER semantics and
--   the query planner sees the static plan. The CASE expressions
--   collapse to no-ops in the non-matching branch (CASE WHEN ...
--   ELSE 0 — and CASE without ELSE returns NULL — so the trailing
--   universal tiebreakers handle ordering uniformly).
--
-- Backwards compatibility:
--   p_sort defaults to 'completeness'. Existing 2-arg callers continue
--   to work via the default. Postgres requires DROP + CREATE when the
--   signature changes (new param), so we drop the previous 2-arg
--   definition first.

BEGIN;

DROP FUNCTION IF EXISTS public.get_top_community_members(TEXT, INT);
DROP FUNCTION IF EXISTS public.get_top_community_members(TEXT, INT, TEXT);

CREATE OR REPLACE FUNCTION public.get_top_community_members(
  p_role TEXT DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_sort TEXT DEFAULT 'completeness'
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
  ORDER BY
    -- Primary key when p_sort = 'availability_activity': open status.
    -- Collapses to 0 (no-op) in the 'completeness' branch.
    CASE WHEN p_sort = 'availability_activity' THEN
      (COALESCE(p.open_to_play, FALSE)
        OR COALESCE(p.open_to_coach, FALSE)
        OR COALESCE(p.open_to_opportunities, FALSE))::int
    ELSE 0 END DESC,
    -- Secondary key when p_sort = 'availability_activity': last active.
    -- The CASE returns NULL for every row in 'completeness' branch, so
    -- DESC NULLS LAST makes this clause a no-op there.
    CASE WHEN p_sort = 'availability_activity' THEN p.last_active_at END
      DESC NULLS LAST,
    -- Primary key when p_sort = 'completeness': profile completeness.
    -- In the 'availability_activity' branch this serves as the
    -- tiebreaker AFTER open status and recent activity, which is fine
    -- (within the same activity bucket, more complete profiles win).
    p.profile_completeness_pct DESC,
    -- Universal tiebreakers — identical across both sorts.
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

COMMENT ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT) IS
  'Top N community profiles per role lane. p_sort=''completeness'' (default) ranks by profile_completeness_pct (use for clubs/coaches/umpires/brands). p_sort=''availability_activity'' ranks by open-to-opportunities + last_active_at (use for the players lane to avoid scoring humans by data-entry). Optional role filter; caps at 100 rows.';

GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT) TO anon;

COMMIT;
