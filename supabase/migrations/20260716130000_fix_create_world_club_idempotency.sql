-- Fix create_world_club_from_career idempotency guard (World Phase 0)
-- ============================================================================
-- The "already exists?" guard used `IF v_existing IS NOT NULL THEN`. v_existing
-- is a RECORD, and in Postgres `record IS NOT NULL` is TRUE only when EVERY
-- field is non-null (composite-null semantics). The selected record includes
-- avatar_url and province_id, which are NULL for every freshly user-created
-- club (no logo, often no region). So the guard evaluated to FALSE even when a
-- matching club WAS found, the function fell through to the INSERT, and hit the
-- unique index idx_world_clubs_name_country_province — surfacing a raw 23505 to
-- the client ("Failed to create club") instead of gracefully returning the
-- existing club.
--
-- This was latent until World Phase 0: before Phase 0 the creation flow was
-- unreachable for countries absent from world_countries_with_directory
-- (Scotland, Ireland, …), so duplicate-name collisions rarely happened. Phase 0
-- opens creation to every country, so two players adding the same club is now a
-- normal case — and "duplicate exact-name behavior" is on the Phase 0 test list.
--
-- Fix:
--   1. Use `IF FOUND` (idiomatic, set correctly by SELECT INTO) for the guard.
--   2. Wrap the INSERT in an EXCEPTION handler so a concurrent creator that
--      wins the race also yields a graceful already_exists=true instead of a
--      unique_violation. Both paths return the same response shape as before.
--
-- Non-breaking: identical signature and JSON shape; strictly more tolerant, so
-- older native bundles calling this RPC only benefit. Server still owns
-- is_claimed=false / created_from='user' — no change to the security posture.
-- CREATE OR REPLACE preserves existing grants.

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
  v_normalized TEXT;
  v_club_id TEXT;
  v_new_id UUID;
  v_existing RECORD;
  v_country_code TEXT;
BEGIN
  -- Normalize the club name
  v_normalized := lower(trim(p_club_name));

  IF length(v_normalized) < 2 THEN
    RAISE EXCEPTION 'Club name must be at least 2 characters';
  END IF;

  -- Check for existing club with same name in same country+province
  SELECT wc.id, wc.club_name, wc.avatar_url, wc.country_id, wc.province_id
    INTO v_existing
    FROM world_clubs wc
   WHERE wc.club_name_normalized = v_normalized
     AND wc.country_id = p_country_id
     AND COALESCE(wc.province_id, 0) = COALESCE(p_province_id, 0);

  -- Idempotent: return the existing club. `IF FOUND` (not `v_existing IS NOT
  -- NULL`, which is false whenever any selected column — avatar_url/province_id
  -- — is null).
  IF FOUND THEN
    RETURN json_build_object(
      'success', true,
      'club_id', v_existing.id,
      'club_name', v_existing.club_name,
      'avatar_url', v_existing.avatar_url,
      'already_exists', true
    );
  END IF;

  -- Get country code for stable club_id generation
  SELECT code INTO v_country_code FROM countries WHERE countries.id = p_country_id;
  IF v_country_code IS NULL THEN
    RAISE EXCEPTION 'Invalid country_id: %', p_country_id;
  END IF;

  -- Generate stable club_id
  v_club_id := replace(v_normalized, ' ', '_') || '_' || lower(v_country_code) || '_' || extract(epoch from now())::bigint;

  -- Create club WITHOUT claiming. If a concurrent request created the same
  -- club between the FOUND check and here, catch the unique violation and
  -- return that club instead of erroring.
  BEGIN
    INSERT INTO world_clubs (
      club_id, club_name, club_name_normalized, country_id, province_id,
      is_claimed, created_from
    ) VALUES (
      v_club_id, trim(p_club_name), v_normalized, p_country_id, p_province_id,
      false, 'user'
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