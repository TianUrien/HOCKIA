-- Add Northern Ireland as a first-class selectable country (World Phase 0)
-- ============================================================================
-- England (GB-ENG), Scotland (GB-SCT) and Wales (GB-WLS) were added in
-- 202601131800_add_uk_constituent_countries; Northern Ireland was left as a
-- TODO (see 20260525040000_discover_country_tolerance.sql:10) and never
-- landed. Field hockey in Northern Ireland runs under Ulster Hockey / Hockey
-- Ireland structures, but players based there must still be able to select
-- their country — a legitimate country must never be unavailable simply
-- because World has no clubs mapped there yet (founder ruling, World Phase 0).
--
-- Same pattern as the sibling constituents: ISO 3166-2 subdivision code.
-- The `code` column is already VARCHAR(6) (widened by 202601131800).
-- Northern Ireland has no official emoji flag of its own; the Union Flag is
-- the only officially flown flag, so it is used as the fallback emoji (the
-- client's flag CDN handles gb-nir directly where supported).

INSERT INTO public.countries (code, code_alpha3, name, nationality_name, region, flag_emoji)
VALUES ('GB-NIR', 'NIR', 'Northern Ireland', 'Northern Irish', 'Europe', '🇬🇧')
ON CONFLICT (code) DO NOTHING;

-- Text alias — SHORT CODE ONLY, matching the established UK-constituent
-- convention already in the DB:
--   'sct' -> GB-SCT, 'wls' -> GB-WLS   (3-letter subdivision code -> constituent)
--   'scotland'/'scottish', 'wales'/'welsh', 'england'/'english',
--   and the pre-existing 'northern ireland'  -> GB (United Kingdom)
-- i.e. full names and nationality words deliberately resolve to the sovereign
-- GB for nationality/passport free-text, while the 3-letter code disambiguates
-- to the constituent. So we add ONLY 'nir' -> GB-NIR. We intentionally do NOT
-- insert 'northern ireland'/'northern irish': 'northern ireland' already
-- resolves to GB (and would no-op here anyway), and pointing 'northern irish'
-- at GB-NIR would make this country inconsistent with 'scottish'/'welsh' -> GB.
-- (match_text_to_country is NOT on the Phase 0 club-creation path, which selects
-- country by id; this only keeps free-text nationality resolution consistent.)
INSERT INTO public.country_text_aliases (alias_text, country_id, confidence)
SELECT 'nir', c.id, 'high'
FROM public.countries c
WHERE c.code = 'GB-NIR'
ON CONFLICT (alias_text) DO NOTHING;

-- Keep the documentation comment accurate.
COMMENT ON COLUMN public.countries.code IS 'ISO 3166-1 alpha-2 code, or ISO 3166-2 subdivision code for UK constituent countries (GB-ENG, GB-SCT, GB-WLS, GB-NIR)';

-- Self-check: the row must exist after this migration (guards against a
-- future conflicting-code edit silently no-opping the insert).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.countries WHERE code = 'GB-NIR') THEN
    RAISE EXCEPTION 'GB-NIR (Northern Ireland) missing from countries after migration';
  END IF;
END $$;
