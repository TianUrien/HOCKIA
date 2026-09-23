-- Figma DEV NOTE · Club & league, DATA FIX 2: 10 of 50 world_leagues on
-- production had no level_band_global, so compute_club_fit's level component
-- scored 0 for every club and player in them. Values follow the curation
-- scale documented in 20260528060000 (and already carried by staging for the
-- same logical_id). Scale: 1 = strongest (Hoofdklasse); 5 = top flights such
-- as England Premier Division, 1. Bundesliga, Serie A Elite; 7 = second tiers
-- such as Serie A1 and Metropolitano C. Leinster Division 1A (Ireland's second
-- tier, below the EY Hockey League) = 7 (founder ruling 2026-09-23).
-- Idempotent: only rows still without a band are touched.
UPDATE public.world_leagues l
   SET level_band_global = v.band
  FROM (VALUES
    ('be_m_1', 2), ('be_w_1', 2), ('be_2', 4),
    ('ger_2', 5),
    ('es_m_1', 3), ('es_w_1', 3), ('es_2', 5),
    ('uy_m_1', 6), ('uy_w_2', 8)
  ) AS v(logical_id, band)
 WHERE l.logical_id = v.logical_id AND l.level_band_global IS NULL;

UPDATE public.world_leagues l
   SET level_band_global = 7
  FROM public.countries c
 WHERE c.id = l.country_id AND c.name = 'Ireland' AND l.name = 'Leinster Division 1A' AND l.level_band_global IS NULL;
