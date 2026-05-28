-- ─────────────────────────────────────────────────────────────────────
-- get_top_community_members — include playing_category in return
-- ─────────────────────────────────────────────────────────────────────
-- Sprint v1 of the Club Fit feature (2026-05-28).
--
-- The carousel + grid need each candidate's playing_category to render
-- the Club Fit chip and to filter the player lane by the viewer club's
-- team category. Adds two columns to the RPC's RETURNS TABLE so the
-- existing single-query path can drive both surfaces:
--
--   - playing_category text   — the Phase 3e category (adult_women,
--                                adult_men, girls, boys, mixed)
--   - gender text             — legacy field, kept as a fallback for
--                                rows that haven't been backfilled to
--                                playing_category yet (rare; safe
--                                belt-and-braces)
--
-- No new parameters; sort behaviour identical. Backwards compatible
-- for existing 4-arg callers — they just get two extra columns.

BEGIN;

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
  accepted_friend_count INTEGER,
  playing_category TEXT,
  gender TEXT
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
    p.accepted_friend_count,
    p.playing_category::TEXT,
    p.gender::TEXT
  FROM public.profiles p
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
$$;

COMMENT ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) IS
  'Top N community profiles per role lane. Returns playing_category + legacy gender so the client can apply Club Fit filtering / chip rendering without an extra round-trip. p_sort: ''completeness'' | ''availability_activity'' | ''recently_joined''. p_only_open: filter to profiles with any open-to-X flag. Caps at 100 rows.';

GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_community_members(TEXT, INT, TEXT, BOOLEAN) TO anon;

COMMIT;
