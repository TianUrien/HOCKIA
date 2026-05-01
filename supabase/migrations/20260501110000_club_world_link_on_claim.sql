-- ============================================================================
-- Club world-link consistency fix
-- ============================================================================
-- The two RPCs that handle world-club identity for clubs onboarding —
-- claim_world_club() and create_and_claim_world_club() — write
-- world_clubs.claimed_profile_id but never write the inverse FK on the
-- profile (profiles.current_world_club_id). The result is a one-way
-- linkage that breaks any feature that joins from the profile side:
--
--   - PlayerDashboard / CoachDashboard read profile.current_world_club_id
--     to render the club's logo next to the user's club label
--   - PublicPlayerProfile reads it for the same reason
--   - Discovery filters / signing announcements that reference a profile's
--     current world club fail silently for clubs themselves
--
-- This migration replaces both functions with versions that ALSO set
-- profiles.current_world_club_id in the same UPDATE the league fields
-- already use. No schema changes — the column already exists.
--
-- Idempotent: CREATE OR REPLACE FUNCTION; behaviour for already-claimed /
-- duplicate-name cases is unchanged. Backfill at the bottom corrects
-- existing claimed-club profiles whose current_world_club_id is NULL.
-- ============================================================================

SET search_path = public;

-- ─── 1. claim_world_club ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_world_club(
  p_world_club_id UUID,
  p_profile_id UUID,
  p_men_league_id INT DEFAULT NULL,
  p_women_league_id INT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club RECORD;
  v_profile_avatar TEXT;
  v_men_league_name TEXT;
  v_women_league_name TEXT;
BEGIN
  SELECT * INTO v_club FROM world_clubs WHERE id = p_world_club_id FOR UPDATE;

  IF v_club IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Club not found');
  END IF;

  IF v_club.is_claimed THEN
    RETURN json_build_object('success', false, 'error', 'Club has already been claimed');
  END IF;

  SELECT avatar_url INTO v_profile_avatar FROM profiles WHERE id = p_profile_id;
  SELECT name INTO v_men_league_name FROM world_leagues WHERE id = p_men_league_id;
  SELECT name INTO v_women_league_name FROM world_leagues WHERE id = p_women_league_id;

  UPDATE world_clubs
  SET
    is_claimed = true,
    claimed_profile_id = p_profile_id,
    claimed_at = timezone('utc', now()),
    men_league_id = p_men_league_id,
    women_league_id = p_women_league_id,
    avatar_url = CASE
      WHEN avatar_url IS NULL AND v_profile_avatar IS NOT NULL THEN v_profile_avatar
      ELSE avatar_url
    END
  WHERE id = p_world_club_id;

  -- Update the profile with league info, world region, AND the inverse
  -- FK back to the world_clubs row. The current_world_club_id column was
  -- previously left NULL — every feature joining from the profile side
  -- silently skipped this club.
  UPDATE profiles
  SET
    current_world_club_id = p_world_club_id,
    mens_league_division = v_men_league_name,
    womens_league_division = v_women_league_name,
    mens_league_id = p_men_league_id,
    womens_league_id = p_women_league_id,
    world_region_id = v_club.province_id,
    avatar_url = CASE
      WHEN avatar_url IS NULL AND v_club.avatar_url IS NOT NULL THEN v_club.avatar_url
      ELSE avatar_url
    END
  WHERE id = p_profile_id;

  RETURN json_build_object('success', true, 'club_id', p_world_club_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_world_club(UUID, UUID, INT, INT) TO authenticated;

-- ─── 2. create_and_claim_world_club ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_and_claim_world_club(
  p_club_name TEXT,
  p_country_id INT,
  p_province_id INT DEFAULT NULL,
  p_profile_id UUID DEFAULT NULL,
  p_men_league_id INT DEFAULT NULL,
  p_women_league_id INT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized TEXT;
  v_club_id TEXT;
  v_new_id UUID;
  v_existing RECORD;
  v_men_league_name TEXT;
  v_women_league_name TEXT;
BEGIN
  v_normalized := lower(trim(p_club_name));

  SELECT * INTO v_existing FROM world_clubs
  WHERE club_name_normalized = v_normalized
    AND country_id = p_country_id
    AND COALESCE(province_id, 0) = COALESCE(p_province_id, 0);

  IF v_existing IS NOT NULL THEN
    RETURN json_build_object('success', false,
      'error', 'A club with this name already exists in this region');
  END IF;

  v_club_id := replace(v_normalized, ' ', '_') || '_' || p_country_id || '_' || extract(epoch from now())::int;

  SELECT name INTO v_men_league_name FROM world_leagues WHERE id = p_men_league_id;
  SELECT name INTO v_women_league_name FROM world_leagues WHERE id = p_women_league_id;

  INSERT INTO world_clubs (
    club_id, club_name, club_name_normalized, country_id, province_id,
    men_league_id, women_league_id, is_claimed, claimed_profile_id,
    claimed_at, created_from
  ) VALUES (
    v_club_id, p_club_name, v_normalized, p_country_id, p_province_id,
    p_men_league_id, p_women_league_id, true, p_profile_id,
    timezone('utc', now()), 'user'
  )
  RETURNING id INTO v_new_id;

  -- Sync league info AND the new world-club FK back to the profile.
  UPDATE profiles
  SET
    current_world_club_id = v_new_id,
    mens_league_id = p_men_league_id,
    womens_league_id = p_women_league_id,
    world_region_id = p_province_id,
    mens_league_division = v_men_league_name,
    womens_league_division = v_women_league_name
  WHERE id = p_profile_id;

  RETURN json_build_object('success', true, 'club_id', v_new_id, 'created', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_and_claim_world_club(TEXT, INT, INT, UUID, INT, INT) TO authenticated;

-- ─── 3. Backfill existing claimed-club profiles ──────────────────────────
-- Any club that claimed (or was created+claimed) before this fix has a
-- world_clubs.claimed_profile_id but a NULL profiles.current_world_club_id.
-- One-time UPDATE corrects them. Safe / idempotent — only writes where
-- the profile FK is currently NULL and the world_clubs row has a claimer.

UPDATE profiles p
SET current_world_club_id = wc.id
FROM world_clubs wc
WHERE wc.claimed_profile_id = p.id
  AND wc.is_claimed = true
  AND p.current_world_club_id IS NULL;

COMMENT ON FUNCTION public.claim_world_club(UUID, UUID, INT, INT) IS
  '2026-05-01: now also writes profiles.current_world_club_id so the inverse FK is consistent. Backfill in same migration.';
COMMENT ON FUNCTION public.create_and_claim_world_club(TEXT, INT, INT, UUID, INT, INT) IS
  '2026-05-01: now also writes profiles.current_world_club_id on create. Backfill in same migration.';
