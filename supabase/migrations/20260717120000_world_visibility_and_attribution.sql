-- World growth Phase 1 — browse visibility for club-only countries + creator attribution
-- ============================================================================
-- Founder-approved workflow: users grow the directory (publish immediately),
-- admin curates afterwards. Two things make that real:
--
-- A. VISIBILITY — world_countries_with_directory listed only countries with
--    ≥1 league (INNER JOIN country_leagues), so a country whose first content
--    is a user-added club (Scotland after Phase 0) stayed invisible in the
--    World browse no matter how many clubs it had. The gate becomes
--    "has any league OR any club". Column list is unchanged, so every
--    consumer keeps working; security_invoker stays on.
--
-- B. ATTRIBUTION — world_clubs.created_by records who added each entry.
--    Without it the admin has no way to know who contributed what, and
--    create_world_club_from_career was still executable by anon (the last
--    anonymous write path into World). The RPC now requires a session,
--    stamps the creator, and anon/PUBLIC lose EXECUTE — invisible to real
--    users (every creation surface is behind login).
--    Best-effort backfill: creator = the claim ledger's created_and_claimed
--    row, else the claiming profile for user-created claimed clubs.
--    Player-created entries from before this migration stay NULL (unknown).

-- ============================================================================
-- 1. Creator attribution column
-- ============================================================================

ALTER TABLE public.world_clubs
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.world_clubs.created_by IS
  'Profile that added this directory entry (any role). Attribution only — ownership lives in is_claimed/claimed_profile_id.';

-- Backfill from the claim ledger (authoritative for club-created entries)…
UPDATE public.world_clubs wc
SET created_by = cl.profile_id
FROM public.world_club_claims cl
WHERE cl.world_club_id = wc.id
  AND cl.action = 'created_and_claimed'
  AND cl.profile_id IS NOT NULL
  AND wc.created_by IS NULL;

-- …then the claiming profile for user-created claimed clubs predating the ledger.
UPDATE public.world_clubs
SET created_by = claimed_profile_id
WHERE created_by IS NULL
  AND created_from = 'user'
  AND claimed_profile_id IS NOT NULL;

-- ============================================================================
-- 2. Browse gate: any league OR any club (was: leagues only)
-- ============================================================================
-- Same output columns in the same order as the live definition, so
-- CREATE OR REPLACE is valid and existing grants are preserved.

CREATE OR REPLACE VIEW public.world_countries_with_directory
WITH (security_invoker = on) AS
WITH country_leagues AS (
  SELECT COALESCE(wl.country_id, wp.country_id) AS country_id,
         count(*) AS total_leagues
  FROM world_leagues wl
  LEFT JOIN world_provinces wp ON wp.id = wl.province_id
  GROUP BY COALESCE(wl.country_id, wp.country_id)
), country_clubs AS (
  SELECT world_clubs.country_id,
         count(*) AS total_clubs
  FROM world_clubs
  GROUP BY world_clubs.country_id
), country_has_regions AS (
  SELECT DISTINCT world_provinces.country_id,
         true AS has_regions
  FROM world_provinces
)
SELECT c.id AS country_id,
       c.code AS country_code,
       c.name AS country_name,
       c.flag_emoji,
       c.region,
       COALESCE(chr.has_regions, false) AS has_regions,
       COALESCE(cl.total_leagues, 0::bigint) AS total_leagues,
       COALESCE(cc.total_clubs, 0::bigint) AS total_clubs
FROM countries c
LEFT JOIN country_leagues cl ON cl.country_id = c.id
LEFT JOIN country_clubs cc ON cc.country_id = c.id
LEFT JOIN country_has_regions chr ON chr.country_id = c.id
WHERE COALESCE(cl.total_leagues, 0) > 0
   OR COALESCE(cc.total_clubs, 0) > 0
ORDER BY c.name;

COMMENT ON VIEW public.world_countries_with_directory IS
  'Countries with any World directory content (league OR club). Community-grown countries appear the moment their first club is added; league-only gating ended with World growth Phase 1.';

-- ============================================================================
-- 3. create_world_club_from_career — require a session, stamp the creator
-- ============================================================================
-- Body is 20260716130000 (IF FOUND idempotency + race handler) plus:
--   - auth.uid() requirement (RAISE, matching this function's validation style)
--   - created_by stamped on INSERT

CREATE OR REPLACE FUNCTION public.create_world_club_from_career(
  p_club_name text,
  p_country_id integer,
  p_province_id integer DEFAULT NULL::integer
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID;
  v_normalized TEXT;
  v_club_id TEXT;
  v_new_id UUID;
  v_existing RECORD;
  v_country_code TEXT;
BEGIN
  -- Every creation surface (onboarding, profile/career editing, admin) is
  -- behind login; an anonymous call is not a legitimate use.
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_normalized := lower(trim(p_club_name));

  IF length(v_normalized) < 2 THEN
    RAISE EXCEPTION 'Club name must be at least 2 characters';
  END IF;

  SELECT wc.id, wc.club_name, wc.avatar_url, wc.country_id, wc.province_id
    INTO v_existing
    FROM world_clubs wc
   WHERE wc.club_name_normalized = v_normalized
     AND wc.country_id = p_country_id
     AND COALESCE(wc.province_id, 0) = COALESCE(p_province_id, 0);

  IF FOUND THEN
    RETURN json_build_object(
      'success', true,
      'club_id', v_existing.id,
      'club_name', v_existing.club_name,
      'avatar_url', v_existing.avatar_url,
      'already_exists', true
    );
  END IF;

  SELECT code INTO v_country_code FROM countries WHERE countries.id = p_country_id;
  IF v_country_code IS NULL THEN
    RAISE EXCEPTION 'Invalid country_id: %', p_country_id;
  END IF;

  v_club_id := replace(v_normalized, ' ', '_') || '_' || lower(v_country_code) || '_' || extract(epoch from now())::bigint;

  BEGIN
    INSERT INTO world_clubs (
      club_id, club_name, club_name_normalized, country_id, province_id,
      is_claimed, created_from, created_by
    ) VALUES (
      v_club_id, trim(p_club_name), v_normalized, p_country_id, p_province_id,
      false, 'user', v_caller
    )
    RETURNING world_clubs.id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT wc.id, wc.club_name, wc.avatar_url
      INTO v_existing
      FROM world_clubs wc
     WHERE wc.club_name_normalized = v_normalized
       AND wc.country_id = p_country_id
       AND COALESCE(wc.province_id, 0) = COALESCE(p_province_id, 0);

    RETURN json_build_object(
      'success', true,
      'club_id', v_existing.id,
      'club_name', v_existing.club_name,
      'avatar_url', v_existing.avatar_url,
      'already_exists', true
    );
  END;

  RETURN json_build_object(
    'success', true,
    'club_id', v_new_id,
    'club_name', trim(p_club_name),
    'avatar_url', NULL,
    'already_exists', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_world_club_from_career(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_world_club_from_career(text, integer, integer) TO authenticated, service_role;

-- ============================================================================
-- 4. create_and_claim_world_club — stamp the creator too
-- ============================================================================
-- Identical to 20260717100000 except created_by lands in the INSERT.

CREATE OR REPLACE FUNCTION public.create_and_claim_world_club(
  p_club_name TEXT,
  p_country_id INT,
  p_province_id INT DEFAULT NULL,
  p_profile_id UUID DEFAULT NULL,
  p_men_league_id INT DEFAULT NULL,
  p_women_league_id INT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller UUID;
  v_role TEXT;
  v_mode TEXT;
  v_normalized TEXT;
  v_club_id TEXT;
  v_new_id UUID;
  v_existing RECORD;
  v_men_league_name TEXT;
  v_women_league_name TEXT;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_profile_id IS DISTINCT FROM v_caller THEN
    RETURN json_build_object('success', false, 'error', 'You can only claim a club for your own account');
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = v_caller;
  IF v_role IS DISTINCT FROM 'club' THEN
    RETURN json_build_object('success', false, 'error', 'Only club accounts can claim a club');
  END IF;

  v_mode := COALESCE(
    (SELECT value FROM app_settings WHERE key = 'world_club_claim_review_mode'),
    'auto'
  );

  v_normalized := lower(trim(p_club_name));
  IF length(v_normalized) < 2 THEN
    RETURN json_build_object('success', false, 'error', 'Club name must be at least 2 characters');
  END IF;

  SELECT * INTO v_existing FROM world_clubs
  WHERE club_name_normalized = v_normalized
    AND country_id = p_country_id
    AND COALESCE(province_id, 0) = COALESCE(p_province_id, 0);
  IF FOUND THEN
    RETURN json_build_object('success', false,
      'error', 'A club with this name already exists in this region');
  END IF;

  v_club_id := replace(v_normalized, ' ', '_') || '_' || p_country_id || '_' || extract(epoch from now())::int;

  SELECT name INTO v_men_league_name FROM world_leagues WHERE id = p_men_league_id;
  SELECT name INTO v_women_league_name FROM world_leagues WHERE id = p_women_league_id;

  BEGIN
    INSERT INTO world_clubs (
      club_id, club_name, club_name_normalized, country_id, province_id,
      men_league_id, women_league_id, is_claimed, claimed_profile_id,
      claimed_at, created_from, created_by
    ) VALUES (
      v_club_id, p_club_name, v_normalized, p_country_id, p_province_id,
      p_men_league_id, p_women_league_id,
      (v_mode <> 'manual'),
      CASE WHEN v_mode <> 'manual' THEN v_caller ELSE NULL END,
      CASE WHEN v_mode <> 'manual' THEN timezone('utc', now()) ELSE NULL END,
      'user', v_caller
    )
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN json_build_object('success', false,
      'error', 'A club with this name already exists in this region');
  END;

  INSERT INTO world_club_claims (world_club_id, profile_id, action, status)
  VALUES (
    v_new_id, v_caller, 'created_and_claimed',
    CASE WHEN v_mode = 'manual' THEN 'pending' ELSE 'auto_approved' END
  );

  UPDATE profiles
  SET
    current_world_club_id = v_new_id,
    mens_league_id = p_men_league_id,
    womens_league_id = p_women_league_id,
    world_region_id = p_province_id,
    mens_league_division = v_men_league_name,
    womens_league_division = v_women_league_name
  WHERE id = v_caller;

  IF v_mode = 'manual' THEN
    RETURN json_build_object('success', true, 'club_id', v_new_id, 'created', true, 'pending', true);
  END IF;
  RETURN json_build_object('success', true, 'club_id', v_new_id, 'created', true);
END;
$function$;

-- ============================================================================
-- 5. Self-checks
-- ============================================================================

DO $$
BEGIN
  -- Anon must no longer be able to create directory entries.
  IF has_function_privilege('anon', 'public.create_world_club_from_career(text, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon still holds EXECUTE on create_world_club_from_career';
  END IF;

  -- A club-only country must now be visible in the browse view
  -- (GB-SCT has clubs and no leagues on both staging and, post-Phase-0, prod).
  IF EXISTS (SELECT 1 FROM public.world_clubs wc JOIN public.countries c ON c.id = wc.country_id WHERE c.code = 'GB-SCT')
     AND NOT EXISTS (SELECT 1 FROM public.world_countries_with_directory WHERE country_code = 'GB-SCT') THEN
    RAISE EXCEPTION 'club-only country (GB-SCT) missing from world_countries_with_directory after gate change';
  END IF;

  -- Ledger-known creators must be attributed.
  IF EXISTS (
    SELECT 1 FROM public.world_clubs wc
    JOIN public.world_club_claims cl ON cl.world_club_id = wc.id
      AND cl.action = 'created_and_claimed' AND cl.profile_id IS NOT NULL
    WHERE wc.created_by IS NULL
  ) THEN
    RAISE EXCEPTION 'created_by backfill incomplete for ledger-known creators';
  END IF;
END $$;