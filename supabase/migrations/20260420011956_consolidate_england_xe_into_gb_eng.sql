-- ============================================================================
-- consolidate_england_xe_into_gb_eng
-- ============================================================================
-- Merges the legacy 'XE' (England placeholder) country row into the existing
-- 'GB-ENG' row. Updates all foreign key references across profiles,
-- world_leagues, world_provinces, world_clubs, and country_text_aliases,
-- then deletes the XE row.
--
-- Safe on any environment: uses code-based lookups, guards against missing
-- rows, checks no references remain before deleting.
--
-- This migration was first applied directly on the HOCKIA project
-- (xtertgftujnebubxgqit) at 2026-04-20 01:19:56 UTC; this file recovers the
-- SQL from supabase_migrations.schema_migrations so the change is tracked
-- in git.
-- ============================================================================

DO $$
DECLARE
  xe_id INT;
  gbeng_id INT;
  updated_profiles INT;
  updated_leagues INT;
  updated_clubs INT;
BEGIN
  SELECT id INTO xe_id FROM public.countries WHERE code = 'XE';
  SELECT id INTO gbeng_id FROM public.countries WHERE code = 'GB-ENG';

  IF xe_id IS NULL OR gbeng_id IS NULL THEN
    RAISE EXCEPTION 'Could not find both XE and GB-ENG country rows (xe=%, gbeng=%)', xe_id, gbeng_id;
  END IF;

  -- 1. Migrate profile references
  UPDATE public.profiles SET base_country_id = gbeng_id WHERE base_country_id = xe_id;
  GET DIAGNOSTICS updated_profiles = ROW_COUNT;
  RAISE NOTICE 'Profiles.base_country_id updated: %', updated_profiles;

  UPDATE public.profiles SET nationality_country_id = gbeng_id WHERE nationality_country_id = xe_id;
  UPDATE public.profiles SET nationality2_country_id = gbeng_id WHERE nationality2_country_id = xe_id;

  -- 2. Migrate leagues
  UPDATE public.world_leagues SET country_id = gbeng_id WHERE country_id = xe_id;
  GET DIAGNOSTICS updated_leagues = ROW_COUNT;
  RAISE NOTICE 'world_leagues updated: %', updated_leagues;

  -- 3. Migrate provinces (should be 0, but included for safety)
  UPDATE public.world_provinces SET country_id = gbeng_id WHERE country_id = xe_id;

  -- 4. Migrate clubs
  UPDATE public.world_clubs SET country_id = gbeng_id WHERE country_id = xe_id;
  GET DIAGNOSTICS updated_clubs = ROW_COUNT;
  RAISE NOTICE 'world_clubs updated: %', updated_clubs;

  -- 5. Migrate text aliases (XE has 0 but included for safety; skip any that would conflict)
  UPDATE public.country_text_aliases a
  SET country_id = gbeng_id
  WHERE a.country_id = xe_id
    AND NOT EXISTS (
      SELECT 1 FROM public.country_text_aliases b
      WHERE b.alias_text = a.alias_text AND b.country_id = gbeng_id
    );

  -- Safety check: confirm no references to XE remain anywhere
  IF EXISTS (SELECT 1 FROM public.profiles WHERE base_country_id = xe_id OR nationality_country_id = xe_id OR nationality2_country_id = xe_id)
     OR EXISTS (SELECT 1 FROM public.world_provinces WHERE country_id = xe_id)
     OR EXISTS (SELECT 1 FROM public.world_leagues WHERE country_id = xe_id)
     OR EXISTS (SELECT 1 FROM public.world_clubs WHERE country_id = xe_id)
     OR EXISTS (SELECT 1 FROM public.country_text_aliases WHERE country_id = xe_id)
  THEN
    RAISE EXCEPTION 'References to XE (id=%) still exist after migration. Aborting delete.', xe_id;
  END IF;

  -- 6. Delete the XE row
  DELETE FROM public.countries WHERE id = xe_id;
  RAISE NOTICE 'Deleted country row XE (id=%)', xe_id;
END $$;
