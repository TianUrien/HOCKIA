-- Rollback for 20261021180000_club_name_casing.sql
-- 1. Restores the club names changed by the one-time casing fix from
--    world_clubs_name_casing_backup (only rows whose name still equals the
--    cased value, so later admin edits are kept).
-- 2. Drops the insert trigger, the casing function, the near-duplicate report
--    and its trigram index, and the backup table.
-- 3. Restores create_world_club_from_career from 20260717120000 (returns the
--    typed name again).
-- Clubs inserted after the migration keep their cased names (nothing records
-- what was typed); that is harmless, only casing differs.

UPDATE public.world_clubs wc
   SET club_name = b.old_name
  FROM public.world_clubs_name_casing_backup b
 WHERE b.id = wc.id
   AND wc.club_name = public.normalize_club_name_casing(b.old_name);

DROP TRIGGER IF EXISTS world_clubs_name_casing ON public.world_clubs;
DROP FUNCTION IF EXISTS public._world_clubs_name_casing();
DROP FUNCTION IF EXISTS public.admin_world_club_near_duplicates(real, int);
DROP INDEX IF EXISTS public.idx_world_clubs_name_trgm;
DROP TABLE IF EXISTS public.world_clubs_name_casing_backup;

-- Body of 20260717120000_world_visibility_and_attribution.sql, unchanged.
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

-- Last, so the restore above could still call it.
DROP FUNCTION IF EXISTS public.normalize_club_name_casing(text);
