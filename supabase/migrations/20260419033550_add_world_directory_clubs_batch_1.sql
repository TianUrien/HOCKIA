-- ============================================================================
-- add_world_directory_clubs_batch_1  (staging version, 2026-04-19 03:35:50 UTC)
-- ============================================================================
-- STAGING-APPLIED version. Uses hardcoded integer IDs resolved at authoring
-- time against staging's `public.countries` and `public.world_leagues` tables
-- (e.g. country_id=191 for NZ, league_id=20 for Germany 2.BL). A later
-- portable rewrite — 20260420011649_add_world_directory_clubs_batch_1.sql —
-- was applied to production using code/logical_id lookups because integer
-- IDs differ between environments.
--
-- Do NOT use this version for fresh database initialisation on any
-- environment other than staging — the hardcoded IDs won't match. Use the
-- 20260420011649 version for production and future environments.
--
-- Tracked in git solely for audit parity with staging's
-- supabase_migrations.schema_migrations table; the migration is already
-- applied on staging and is marked as applied on production via repair.
-- ============================================================================

DO $$
DECLARE
  p_auckland_id INT;
  p_otago_id INT;
  l_auckland_id INT;
  l_otago_id INT;
  l_uy_m_id INT;
  l_uy_w2_id INT;
BEGIN
  -- === 1) Provinces (NZ only) ===
  INSERT INTO public.world_provinces (country_id, name, slug, logical_id, display_order)
  VALUES (191, 'Auckland', 'auckland', 'nz_auckland', 1)
  RETURNING id INTO p_auckland_id;

  INSERT INTO public.world_provinces (country_id, name, slug, logical_id, display_order)
  VALUES (191, 'Otago', 'otago', 'nz_otago', 2)
  RETURNING id INTO p_otago_id;

  -- === 2) Leagues (NZ + UY) ===
  INSERT INTO public.world_leagues (country_id, province_id, name, slug, logical_id, tier, display_order)
  VALUES (191, p_auckland_id, 'Auckland Premiership', 'auckland-premiership', 'nz_auckland_1', 1, 1)
  RETURNING id INTO l_auckland_id;

  INSERT INTO public.world_leagues (country_id, province_id, name, slug, logical_id, tier, display_order)
  VALUES (191, p_otago_id, 'Otago Club Competition', 'otago-club-competition', 'nz_otago_1', 1, 1)
  RETURNING id INTO l_otago_id;

  INSERT INTO public.world_leagues (country_id, province_id, name, slug, logical_id, tier, display_order)
  VALUES (58, NULL, 'FUH Primera Varones', 'fuh-primera-varones', 'uy_m_1', 1, 1)
  RETURNING id INTO l_uy_m_id;

  INSERT INTO public.world_leagues (country_id, province_id, name, slug, logical_id, tier, display_order)
  VALUES (58, NULL, 'FUH Intermedia A', 'fuh-intermedia-a', 'uy_w_2', 2, 2)
  RETURNING id INTO l_uy_w2_id;

  -- === 3) Clubs (101 total) ===
  INSERT INTO public.world_clubs
    (club_id, club_name, club_name_normalized, country_id, province_id, men_league_id, women_league_id, created_from)
  VALUES
  -- Germany (20) — country 15, leagues 19=1.BL, 20=2.BL
  ('berliner_hc_de', 'Berliner HC', lower('Berliner HC'), 15, NULL, 20, 19, 'admin'),
  ('bremer_hc_de', 'Bremer HC', lower('Bremer HC'), 15, NULL, NULL, 19, 'admin'),
  ('tc_bw_berlin_de', 'TC BW Berlin', lower('TC BW Berlin'), 15, NULL, 20, NULL, 'admin'),
  ('stuttgarter_htc_de', 'HTC Stuttgarter Kickers', lower('HTC Stuttgarter Kickers'), 15, NULL, 20, NULL, 'admin'),
  ('wiesbadener_thc_de', 'Wiesbadener THC', lower('Wiesbadener THC'), 15, NULL, 20, NULL, 'admin'),
  ('nuernberger_htc_de', 'Nürnberger HTC', lower('Nürnberger HTC'), 15, NULL, 20, 20, 'admin'),
  ('hg_nuernberg_de', 'HG Nürnberg', lower('HG Nürnberg'), 15, NULL, 20, 20, 'admin'),
  ('ludwigsburg_de', 'HC Ludwigsburg', lower('HC Ludwigsburg'), 15, NULL, 20, 20, 'admin'),
  ('tg_frankenthal_de', 'TG Frankenthal', lower('TG Frankenthal'), 15, NULL, 20, NULL, 'admin'),
  ('coethener_de', 'Cöthener HC 02', lower('Cöthener HC 02'), 15, NULL, 20, NULL, 'admin'),
  ('rthc_leverkusen_de', 'RTHC Bayer Leverkusen', lower('RTHC Bayer Leverkusen'), 15, NULL, NULL, 20, 'admin'),
  ('eintracht_bs_de', 'Eintracht Braunschweig', lower('Eintracht Braunschweig'), 15, NULL, NULL, 20, 'admin'),
  ('klipper_hamburg_de', 'Klipper THC Hamburg', lower('Klipper THC Hamburg'), 15, NULL, NULL, 20, 'admin'),
  ('tg_heimfeld_de', 'TG Heimfeld', lower('TG Heimfeld'), 15, NULL, NULL, 20, 'admin'),
  ('bw_koeln_de', 'Blau Weiss Köln', lower('Blau Weiss Köln'), 15, NULL, NULL, 20, 'admin'),
  ('feudenheimer_de', 'Feudenheimer HC', lower('Feudenheimer HC'), 15, NULL, NULL, 20, 'admin'),
  ('tus_lichterfelde_de', 'TuS Lichterfelde', lower('TuS Lichterfelde'), 15, NULL, NULL, 20, 'admin'),
  ('hanauer_thc_de', '1. Hanauer THC', lower('1. Hanauer THC'), 15, NULL, NULL, 20, 'admin'),
  ('ruesselsheimer_de', 'Rüsselsheimer RK', lower('Rüsselsheimer RK'), 15, NULL, NULL, 20, 'admin'),
  ('rotation_prenz_de', 'SG Rotation Prenzlauer Berg', lower('SG Rotation Prenzlauer Berg'), 15, NULL, NULL, 20, 'admin'),

  -- England (8) — country 202, league 13=Premier Division
  ('beeston_en', 'Beeston HC', lower('Beeston HC'), 202, NULL, 13, NULL, 'admin'),
  ('brooklands_en', 'Brooklands Manchester University', lower('Brooklands Manchester University'), 202, NULL, 13, NULL, 'admin'),
  ('cardiff_met_en', 'Cardiff & Met HC', lower('Cardiff & Met HC'), 202, NULL, 13, NULL, 'admin'),
  ('old_georgians_en', 'Old Georgians HC', lower('Old Georgians HC'), 202, NULL, 13, NULL, 'admin'),
  ('oxted_en', 'Oxted HC', lower('Oxted HC'), 202, NULL, 13, NULL, 'admin'),
  ('southgate_en', 'Southgate HC', lower('Southgate HC'), 202, NULL, 13, NULL, 'admin'),
  ('barnes_en', 'Barnes HC', lower('Barnes HC'), 202, NULL, NULL, 13, 'admin'),
  ('durham_uni_en', 'Durham University HC', lower('Durham University HC'), 202, NULL, NULL, 13, 'admin'),

  -- Belgium (4) — country 5, league 40=National 1
  ('daring_be', 'Royal Daring HC', lower('Royal Daring HC'), 5, NULL, 40, NULL, 'admin'),
  ('namur_be', 'Hockey Namur (RHCN)', lower('Hockey Namur (RHCN)'), 5, NULL, 40, NULL, 'admin'),
  ('white_star_be', 'Royal Evere White Star HC', lower('Royal Evere White Star HC'), 5, NULL, NULL, 40, 'admin'),
  ('mechelse_be', 'KMTHC Mechelse', lower('KMTHC Mechelse'), 5, NULL, NULL, 40, 'admin'),

  -- Spain (19) — country 41, league 37=División de Honor B
  ('san_vicente_es', 'UA-San Vicente', lower('UA-San Vicente'), 41, NULL, 37, 37, 'admin'),
  ('rs_1927_es', 'Real Sociedad 1927', lower('Real Sociedad 1927'), 41, NULL, 37, NULL, 'admin'),
  ('sant_cugat_es', 'HC Sant Cugat', lower('HC Sant Cugat'), 41, NULL, 37, 37, 'admin'),
  ('valles_esp_es', 'Vallès Esportiu', lower('Vallès Esportiu'), 41, NULL, 37, 37, 'admin'),
  ('iluro_es', 'Iluro HC', lower('Iluro HC'), 41, NULL, 37, NULL, 'admin'),
  ('linia22_es', 'Linia 22 HC Stern Motor', lower('Linia 22 HC Stern Motor'), 41, NULL, 37, NULL, 'admin'),
  ('benalmadena_es', 'RH Privé Benalmádena', lower('RH Privé Benalmádena'), 41, NULL, 37, NULL, 'admin'),
  ('giner_rios_es', 'CD Giner de los Ríos', lower('CD Giner de los Ríos'), 41, NULL, 37, 37, 'admin'),
  ('pedralbes_es', 'Pedralbes HC', lower('Pedralbes HC'), 41, NULL, 37, NULL, 'admin'),
  ('spv_es', 'SPV', lower('SPV'), 41, NULL, 37, NULL, 'admin'),
  ('carpesa_es', 'CH Carpesa', lower('CH Carpesa'), 41, NULL, 37, NULL, 'admin'),
  ('egara_1935_es', 'Egara 1935', lower('Egara 1935'), 41, NULL, 37, NULL, 'admin'),
  ('ad_rimas_es', 'AD Rimas', lower('AD Rimas'), 41, NULL, 37, NULL, 'admin'),
  ('pozuelo_es', 'CH Pozuelo', lower('CH Pozuelo'), 41, NULL, NULL, 37, 'admin'),
  ('carranque_es', 'Carranque Candelaria', lower('Carranque Candelaria'), 41, NULL, NULL, 37, 'admin'),
  ('xaloc_es', 'CH Xaloc', lower('CH Xaloc'), 41, NULL, NULL, 37, 'admin'),
  ('san_fernando_es', 'CH San Fernando', lower('CH San Fernando'), 41, NULL, NULL, 37, 'admin'),
  ('covadonga_es', 'RGC Covadonga', lower('RGC Covadonga'), 41, NULL, NULL, 37, 'admin'),
  ('valencia_ch_es', 'Valencia CH', lower('Valencia CH'), 41, NULL, NULL, 37, 'admin'),

  -- Italy (12) — country 20, league 17=Serie A1
  ('cus_cagliari_it', 'CUS Cagliari', lower('CUS Cagliari'), 20, NULL, 17, 17, 'admin'),
  ('cus_padova_it', 'CUS Padova', lower('CUS Padova'), 20, NULL, 17, 17, 'admin'),
  ('bondeno_it', 'Hockey Club Bondeno', lower('Hockey Club Bondeno'), 20, NULL, 17, NULL, 'admin'),
  ('riva_it', 'Hockey Club Riva', lower('Hockey Club Riva'), 20, NULL, 17, 17, 'admin'),
  ('uhc_adige_it', 'UHC Adige', lower('UHC Adige'), 20, NULL, 17, NULL, 'admin'),
  ('san_giorgio_it', 'CSP San Giorgio', lower('CSP San Giorgio'), 20, NULL, 17, NULL, 'admin'),
  ('cus_pisa_it', 'CUS Pisa', lower('CUS Pisa'), 20, NULL, 17, 17, 'admin'),
  ('potenza_picena_it', 'Hockey Club Potenza Picena', lower('Hockey Club Potenza Picena'), 20, NULL, 17, NULL, 'admin'),
  ('juvenilia_uras_it', 'Polisportiva Juvenilia Uras', lower('Polisportiva Juvenilia Uras'), 20, NULL, 17, 17, 'admin'),
  ('paolo_bonomi_it', 'SH Paolo Bonomi', lower('SH Paolo Bonomi'), 20, NULL, 17, NULL, 'admin'),
  ('argentia_it', 'HC Argentia', lower('HC Argentia'), 20, NULL, NULL, 17, 'admin'),
  ('sardegna_uras_it', 'Hockey Team Sardegna (Uras)', lower('Hockey Team Sardegna (Uras)'), 20, NULL, NULL, 17, 'admin'),

  -- New Zealand — Auckland (11) — country 191, province p_auckland_id, league l_auckland_id
  ('aisc_nz', 'AISC', lower('AISC'), 191, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('auckland_uni_nz', 'Auckland University', lower('Auckland University'), 191, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('grammar_windsor_nz', 'Grammar Windsor', lower('Grammar Windsor'), 191, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('howick_pakuranga_nz', 'Howick Pakuranga', lower('Howick Pakuranga'), 191, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('mt_eden_nz', 'Mt Eden', lower('Mt Eden'), 191, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('masters_women_nz', 'Masters Women', lower('Masters Women'), 191, p_auckland_id, NULL, l_auckland_id, 'admin'),
  ('roskill_eden_nz', 'Roskill Eden', lower('Roskill Eden'), 191, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('somerville_nz', 'Somerville', lower('Somerville'), 191, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('southern_districts_nz', 'Southern Districts', lower('Southern Districts'), 191, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('waitakere_nz', 'Waitakere', lower('Waitakere'), 191, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('western_districts_nz', 'Western Districts', lower('Western Districts'), 191, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),

  -- New Zealand — Otago (11)
  ('albany_nz', 'Albany Hockey Club', lower('Albany Hockey Club'), 191, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('city_highlanders_nz', 'City Highlanders Hockey Club', lower('City Highlanders Hockey Club'), 191, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('ketob_women_nz', 'KETOB Women', lower('KETOB Women'), 191, p_otago_id, NULL, l_otago_id, 'admin'),
  ('ketob_men_nz', 'KETOB Men', lower('KETOB Men'), 191, p_otago_id, l_otago_id, NULL, 'admin'),
  ('kings_united_nz', 'Kings United Hockey Club', lower('Kings United Hockey Club'), 191, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('momona_nz', 'Momona Hockey Club', lower('Momona Hockey Club'), 191, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('otago_uni_nz', 'Otago University Hockey Club', lower('Otago University Hockey Club'), 191, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('southland_barbarians_nz', 'Southland Barbarians Hockey Club', lower('Southland Barbarians Hockey Club'), 191, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('taieri_nz', 'Taieri Hockey Club', lower('Taieri Hockey Club'), 191, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('tainui_nz', 'Tainui Hockey Club', lower('Tainui Hockey Club'), 191, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('west_taieri_nz', 'West Taieri Ladies Hockey Club', lower('West Taieri Ladies Hockey Club'), 191, p_otago_id, NULL, l_otago_id, 'admin'),

  -- Uruguay (16) — country 58, league 41=Primera Damas, + new l_uy_m_id (Primera Varones) + l_uy_w2_id (Intermedia A)
  ('bigua_uy', 'Club Biguá', lower('Club Biguá'), 58, NULL, NULL, 41, 'admin'),
  ('carrasco_polo_uy', 'Carrasco Polo Club', lower('Carrasco Polo Club'), 58, NULL, NULL, 41, 'admin'),
  ('nautico_carrasco_uy', 'Club Náutico de Carrasco y Punta Gorda', lower('Club Náutico de Carrasco y Punta Gorda'), 58, NULL, NULL, 41, 'admin'),
  ('seminario_uy', 'Club Seminario', lower('Club Seminario'), 58, NULL, l_uy_m_id, 41, 'admin'),
  ('ivy_thomas_uy', 'Ivy Thomas', lower('Ivy Thomas'), 58, NULL, NULL, 41, 'admin'),
  ('obcyogc_uy', 'Old Boys & Old Girls Club (Old Girls Club)', lower('Old Boys & Old Girls Club (Old Girls Club)'), 58, NULL, NULL, 41, 'admin'),
  ('old_sampa_uy', 'Old Sampa Club', lower('Old Sampa Club'), 58, NULL, NULL, 41, 'admin'),
  ('old_woodlands_uy', 'Old Woodlands Club', lower('Old Woodlands Club'), 58, NULL, NULL, 41, 'admin'),
  ('ycu_uy', 'Yacht Club Uruguayo', lower('Yacht Club Uruguayo'), 58, NULL, NULL, 41, 'admin'),
  ('lobos_uy', 'Lobos Rugby Club', lower('Lobos Rugby Club'), 58, NULL, l_uy_m_id, l_uy_w2_id, 'admin'),
  ('old_brendans_uy', 'Old Brendan''s Club', lower('Old Brendan''s Club'), 58, NULL, NULL, l_uy_w2_id, 'admin'),
  ('ort_uy', 'Universidad ORT Uruguay', lower('Universidad ORT Uruguay'), 58, NULL, NULL, l_uy_w2_id, 'admin'),
  ('palo_pico_uy', 'Palo y Pico', lower('Palo y Pico'), 58, NULL, NULL, l_uy_w2_id, 'admin'),
  ('psg_uy', 'PSG (Pucaru Stade Gaulois)', lower('PSG (Pucaru Stade Gaulois)'), 58, NULL, l_uy_m_id, NULL, 'admin'),
  ('northfield_uy', 'Northfield Centro Deportivo', lower('Northfield Centro Deportivo'), 58, NULL, l_uy_m_id, NULL, 'admin'),
  ('jupave_uy', 'JUPAVE Hockey Club', lower('JUPAVE Hockey Club'), 58, NULL, l_uy_m_id, NULL, 'admin');

END $$;
