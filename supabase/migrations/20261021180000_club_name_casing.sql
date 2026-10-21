-- Directory club names: consistent casing, and a near-duplicate report for admins.
--
-- Brief: quick wins batch 2026-10-21, item 2 (founder-approved). Members type
-- club names in any casing ("university of the western cape"); the directory
-- then shows them as typed. This migration:
--   1. adds public.normalize_club_name_casing(text): trim, collapse inner
--      whitespace, capitalise the first letter of every word that is entirely
--      lowercase (hyphenated parts count as words), except common particles
--      (de, del, of, the, van, ...) when they are not the first word. Words with
--      any uppercase letter or digit are kept exactly as typed ("HC", "A1",
--      "McDonald"); common club abbreviations typed in lowercase ("hc", "fc",
--      "tsv") become uppercase. Spelling and accents never change. The client mirror is
--      client/src/lib/clubNameCasing.ts (keep both in step).
--   2. applies it on every INSERT into world_clubs (BEFORE INSERT trigger).
--      club_name_normalized keeps being set by the creating RPCs
--      (lower(trim(typed))); casing never changes lower(), so the unique index
--      (club_name_normalized, country_id, coalesce(province_id, 0)) and the
--      RPCs' dedupe lookups behave exactly as before. A NULL normalized value
--      is filled from the cased name. Admin edits (UPDATE) are left alone, so
--      an admin can still set an unusual casing by hand.
--   3. one-time fix of existing names, with the old values kept in a
--      service-role-only backup table so the rollback can restore them.
--   4. create_world_club_from_career returns the stored (cased) name instead
--      of the typed one. Body copied from 20260717120000; only the RETURNING
--      and the final club_name change.
--   5. admin_world_club_near_duplicates(): admin-only list of likely duplicate
--      pairs inside a country (pg_trgm similarity, or equal once punctuation and
--      the words hockey / club / hc / fc are removed). Read-only; merging is manual.
--
-- No club names are hardcoded here: the rule does the work.
-- Rollback: supabase/rollbacks/20261021180000_club_name_casing.down.sql

-- ============================================================================
-- 1. The casing rule
-- ============================================================================
CREATE OR REPLACE FUNCTION public.normalize_club_name_casing(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $function$
DECLARE
  c_particles constant text[] := ARRAY[
    'de','del','della','di','da','do','dos','das','la','le','les','el','los','las',
    'y','e','of','the','and','van','von','der','den','het','du','des','et','a','en','at','on',
    -- German, Dutch, French, Catalan particles ("Der Club an der Alster", "aan de Amstel")
    'an','am','im','auf','zu','zum','zur','und','aan','op','te','ter','in','al','au','aux','sur','i'
  ];
  -- Club-type abbreviations typed in lowercase become uppercase ("the hague hc"
  -- -> "The Hague HC"), never "Hc".
  c_acronyms constant text[] := ARRAY[
    'hc','fc','sc','ac','hv','mhc','whc','thc','hhc','rhc','lhc','bhc','chc','tsv','sv','vfl','vfb','tc','rc','cd','cf','ymca'
  ];
  v_clean text;
  v_words text[];
  v_parts text[];
  v_out_words text[] := ARRAY[]::text[];
  v_out_parts text[];
  v_word text;
  v_part text;
  v_first boolean := true;
  v_i int;
  v_ch text;
BEGIN
  IF p_name IS NULL THEN
    RETURN NULL;
  END IF;
  v_clean := regexp_replace(btrim(p_name), '\s+', ' ', 'g');
  IF v_clean = '' THEN
    RETURN v_clean;
  END IF;

  v_words := string_to_array(v_clean, ' ');
  FOREACH v_word IN ARRAY v_words LOOP
    v_parts := string_to_array(v_word, '-');
    v_out_parts := ARRAY[]::text[];
    FOREACH v_part IN ARRAY v_parts LOOP
      IF v_part <> '' AND v_part = ANY (c_acronyms) THEN
        v_part := upper(v_part);
      -- Entirely lowercase letters: no uppercase, no digit, at least one cased letter.
      ELSIF v_part <> ''
         AND v_part = lower(v_part)
         AND v_part <> upper(v_part)
         AND v_part !~ '[0-9]'
         AND NOT (NOT v_first AND v_part = ANY (c_particles)) THEN
        -- Capitalise the first cased character; everything else stays as typed.
        FOR v_i IN 1..length(v_part) LOOP
          v_ch := substr(v_part, v_i, 1);
          IF upper(v_ch) <> v_ch THEN
            v_part := substr(v_part, 1, v_i - 1) || upper(v_ch) || substr(v_part, v_i + 1);
            EXIT;
          END IF;
        END LOOP;
      END IF;
      IF v_part <> '' THEN
        v_first := false;
      END IF;
      v_out_parts := v_out_parts || v_part;
    END LOOP;
    v_out_words := v_out_words || array_to_string(v_out_parts, '-');
  END LOOP;

  RETURN array_to_string(v_out_words, ' ');
END;
$function$;

COMMENT ON FUNCTION public.normalize_club_name_casing(text) IS
  'Club name casing rule (2026-10-21). Mirror: client/src/lib/clubNameCasing.ts.';

REVOKE ALL ON FUNCTION public.normalize_club_name_casing(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_club_name_casing(text) TO authenticated, service_role;

-- ============================================================================
-- 2. Apply it on insert
-- ============================================================================
CREATE OR REPLACE FUNCTION public._world_clubs_name_casing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.club_name := public.normalize_club_name_casing(NEW.club_name);
  IF NEW.club_name_normalized IS NULL THEN
    NEW.club_name_normalized := lower(NEW.club_name);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public._world_clubs_name_casing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._world_clubs_name_casing() TO service_role;

DROP TRIGGER IF EXISTS world_clubs_name_casing ON public.world_clubs;
CREATE TRIGGER world_clubs_name_casing
  BEFORE INSERT ON public.world_clubs
  FOR EACH ROW
  EXECUTE FUNCTION public._world_clubs_name_casing();

-- ============================================================================
-- 3. One-time fix of existing names (old values kept for the rollback)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.world_clubs_name_casing_backup (
  id uuid PRIMARY KEY,
  old_name text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.world_clubs_name_casing_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.world_clubs_name_casing_backup FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.world_clubs_name_casing_backup TO service_role;
COMMENT ON TABLE public.world_clubs_name_casing_backup IS
  'Club names before the 2026-10-21 casing fix; read by the rollback only. Service role only.';

INSERT INTO public.world_clubs_name_casing_backup (id, old_name)
SELECT wc.id, wc.club_name
  FROM public.world_clubs wc
 WHERE wc.club_name IS DISTINCT FROM public.normalize_club_name_casing(wc.club_name)
ON CONFLICT (id) DO NOTHING;

-- Only club_name changes; club_name_normalized (the unique index key) is not
-- touched, so no row can collide with another. The client-update guard trigger
-- acts only for current_user = 'authenticated', so it does not fire here.
UPDATE public.world_clubs wc
   SET club_name = public.normalize_club_name_casing(wc.club_name)
 WHERE wc.club_name IS DISTINCT FROM public.normalize_club_name_casing(wc.club_name);

-- ============================================================================
-- 4. create_world_club_from_career returns the stored name
-- ============================================================================
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
  v_new_name TEXT;
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
    RETURNING world_clubs.id, world_clubs.club_name INTO v_new_id, v_new_name;
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
    'club_name', v_new_name,
    'avatar_url', NULL,
    'already_exists', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_world_club_from_career(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_world_club_from_career(text, integer, integer) TO authenticated, service_role;

-- ============================================================================
-- 5. Near-duplicate report (admin only, read-only)
-- ============================================================================
-- pg_trgm lives in public (202512091000_countries_normalization.sql); the
-- search_path also lists extensions in case it is moved there later.
CREATE INDEX IF NOT EXISTS idx_world_clubs_name_trgm
  ON public.world_clubs USING gin (club_name_normalized gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.admin_world_club_near_duplicates(
  p_threshold real DEFAULT 0.6,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  a_id uuid,
  a_name text,
  b_id uuid,
  b_name text,
  country_name text,
  similarity real,
  a_is_claimed boolean,
  b_is_claimed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  -- The % operator reads this threshold and can use the trigram index.
  PERFORM set_config('pg_trgm.similarity_threshold', GREATEST(LEAST(COALESCE(p_threshold, 0.6), 1), 0.1)::text, true);

  RETURN QUERY
  WITH keyed AS (
    SELECT wc.id, wc.club_name, wc.club_name_normalized AS n, wc.country_id, wc.is_claimed,
           regexp_replace(
             regexp_replace(wc.club_name_normalized, '\m(hockey|club|hc|fc)\M', '', 'g'),
             '[^[:alnum:]]', '', 'g') AS k
      FROM world_clubs wc
  ),
  pairs AS (
    SELECT a.id AS a_id, b.id AS b_id
      FROM world_clubs a
      JOIN world_clubs b
        ON b.country_id = a.country_id
       AND a.id < b.id
       AND a.club_name_normalized % b.club_name_normalized
    UNION
    SELECT a.id, b.id
      FROM keyed a
      JOIN keyed b
        ON b.country_id = a.country_id
       AND a.id < b.id
       AND a.k = b.k
       AND a.k <> ''
  )
  SELECT ka.id, ka.club_name, kb.id, kb.club_name, c.name::text,
         similarity(ka.n, kb.n)::real,
         ka.is_claimed, kb.is_claimed
    FROM pairs p
    JOIN keyed ka ON ka.id = p.a_id
    JOIN keyed kb ON kb.id = p.b_id
    JOIN countries c ON c.id = ka.country_id
   ORDER BY similarity(ka.n, kb.n) DESC, c.name, ka.club_name
   LIMIT GREATEST(LEAST(COALESCE(p_limit, 200), 1000), 1);
END;
$function$;

COMMENT ON FUNCTION public.admin_world_club_near_duplicates(real, int) IS
  'Admin-only: likely duplicate world_clubs pairs within a country. Returns clubs, not people. Read-only.';

REVOKE ALL ON FUNCTION public.admin_world_club_near_duplicates(real, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_world_club_near_duplicates(real, int) TO authenticated, service_role;
