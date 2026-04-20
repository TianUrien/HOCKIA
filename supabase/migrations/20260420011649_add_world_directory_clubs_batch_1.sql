-- ============================================================================
-- add_world_directory_clubs_batch_1
-- ============================================================================
-- Seeds 101 clubs across Germany, England, Belgium, Spain, Italy, New Zealand
-- and Uruguay into public.world_clubs, along with two NZ provinces and four
-- new leagues (NZ Auckland, NZ Otago, UY Primera Varones, UY Intermedia A).
--
-- This migration was first applied directly on the HOCKIA project
-- (xtertgftujnebubxgqit) at 2026-04-20 01:16:49 UTC; this file recovers the
-- SQL from supabase_migrations.schema_migrations so the change is tracked in
-- git. Uses code-based lookups (WHERE code='DE', WHERE logical_id='ger_1')
-- so the migration is portable across environments — not dependent on
-- hardcoded integer IDs.
-- ============================================================================

DO $$
DECLARE
  p_auckland_id INT;
  p_otago_id INT;
  l_auckland_id INT;
  l_otago_id INT;
  l_uy_m_id INT;
  l_uy_w2_id INT;
  c_de INT; c_en INT; c_be INT; c_es INT; c_it INT; c_nz INT; c_uy INT;
  l_de_1 INT; l_de_2 INT;
  l_en_1 INT;
  l_be_nat1 INT;
  l_es_b INT;
  l_it_a1 INT;
  l_uy_w1 INT;
BEGIN
  -- Resolve country IDs by code (prod-independent)
  SELECT id INTO c_de FROM public.countries WHERE code = 'DE';
  SELECT id INTO c_be FROM public.countries WHERE code = 'BE';
  SELECT id INTO c_es FROM public.countries WHERE code = 'ES';
  SELECT id INTO c_it FROM public.countries WHERE code = 'IT';
  SELECT id INTO c_nz FROM public.countries WHERE code = 'NZ';
  SELECT id INTO c_uy FROM public.countries WHERE code = 'UY';
  SELECT id INTO c_en FROM public.countries WHERE name = 'England';

  -- Resolve existing league IDs by logical_id (prod-independent)
  SELECT id INTO l_de_1   FROM public.world_leagues WHERE logical_id = 'ger_1';
  SELECT id INTO l_de_2   FROM public.world_leagues WHERE logical_id = 'ger_2';
  SELECT id INTO l_en_1   FROM public.world_leagues WHERE logical_id = 'en_1';
  SELECT id INTO l_be_nat1 FROM public.world_leagues WHERE logical_id = 'be_2';
  SELECT id INTO l_es_b   FROM public.world_leagues WHERE logical_id = 'es_2';
  SELECT id INTO l_it_a1  FROM public.world_leagues WHERE logical_id = 'it_w_2';
  SELECT id INTO l_uy_w1  FROM public.world_leagues WHERE logical_id = 'uy_w_1';

  -- === 1) Provinces (NZ only) ===
  INSERT INTO public.world_provinces (country_id, name, slug, logical_id, display_order)
  VALUES (c_nz, 'Auckland', 'auckland', 'nz_auckland', 1)
  RETURNING id INTO p_auckland_id;

  INSERT INTO public.world_provinces (country_id, name, slug, logical_id, display_order)
  VALUES (c_nz, 'Otago', 'otago', 'nz_otago', 2)
  RETURNING id INTO p_otago_id;

  -- === 2) Leagues (NZ + UY) ===
  INSERT INTO public.world_leagues (country_id, province_id, name, slug, logical_id, tier, display_order)
  VALUES (c_nz, p_auckland_id, 'Auckland Premiership', 'auckland-premiership', 'nz_auckland_1', 1, 1)
  RETURNING id INTO l_auckland_id;

  INSERT INTO public.world_leagues (country_id, province_id, name, slug, logical_id, tier, display_order)
  VALUES (c_nz, p_otago_id, 'Otago Club Competition', 'otago-club-competition', 'nz_otago_1', 1, 1)
  RETURNING id INTO l_otago_id;

  INSERT INTO public.world_leagues (country_id, province_id, name, slug, logical_id, tier, display_order)
  VALUES (c_uy, NULL, 'FUH Primera Varones', 'fuh-primera-varones', 'uy_m_1', 1, 1)
  RETURNING id INTO l_uy_m_id;

  INSERT INTO public.world_leagues (country_id, province_id, name, slug, logical_id, tier, display_order)
  VALUES (c_uy, NULL, 'FUH Intermedia A', 'fuh-intermedia-a', 'uy_w_2', 2, 2)
  RETURNING id INTO l_uy_w2_id;

  -- === 3) Clubs (101 total) ===
  INSERT INTO public.world_clubs
    (club_id, club_name, club_name_normalized, country_id, province_id, men_league_id, women_league_id, created_from)
  VALUES
  -- Germany (20)
  ('berliner_hc_de', 'Berliner HC', lower('Berliner HC'), c_de, NULL, l_de_2, l_de_1, 'admin'),
  ('bremer_hc_de', 'Bremer HC', lower('Bremer HC'), c_de, NULL, NULL, l_de_1, 'admin'),
  ('tc_bw_berlin_de', 'TC BW Berlin', lower('TC BW Berlin'), c_de, NULL, l_de_2, NULL, 'admin'),
  ('stuttgarter_htc_de', 'HTC Stuttgarter Kickers', lower('HTC Stuttgarter Kickers'), c_de, NULL, l_de_2, NULL, 'admin'),
  ('wiesbadener_thc_de', 'Wiesbadener THC', lower('Wiesbadener THC'), c_de, NULL, l_de_2, NULL, 'admin'),
  ('nuernberger_htc_de', 'Nürnberger HTC', lower('Nürnberger HTC'), c_de, NULL, l_de_2, l_de_2, 'admin'),
  ('hg_nuernberg_de', 'HG Nürnberg', lower('HG Nürnberg'), c_de, NULL, l_de_2, l_de_2, 'admin'),
  ('ludwigsburg_de', 'HC Ludwigsburg', lower('HC Ludwigsburg'), c_de, NULL, l_de_2, l_de_2, 'admin'),
  ('tg_frankenthal_de', 'TG Frankenthal', lower('TG Frankenthal'), c_de, NULL, l_de_2, NULL, 'admin'),
  ('coethener_de', 'Cöthener HC 02', lower('Cöthener HC 02'), c_de, NULL, l_de_2, NULL, 'admin'),
  ('rthc_leverkusen_de', 'RTHC Bayer Leverkusen', lower('RTHC Bayer Leverkusen'), c_de, NULL, NULL, l_de_2, 'admin'),
  ('eintracht_bs_de', 'Eintracht Braunschweig', lower('Eintracht Braunschweig'), c_de, NULL, NULL, l_de_2, 'admin'),
  ('klipper_hamburg_de', 'Klipper THC Hamburg', lower('Klipper THC Hamburg'), c_de, NULL, NULL, l_de_2, 'admin'),
  ('tg_heimfeld_de', 'TG Heimfeld', lower('TG Heimfeld'), c_de, NULL, NULL, l_de_2, 'admin'),
  ('bw_koeln_de', 'Blau Weiss Köln', lower('Blau Weiss Köln'), c_de, NULL, NULL, l_de_2, 'admin'),
  ('feudenheimer_de', 'Feudenheimer HC', lower('Feudenheimer HC'), c_de, NULL, NULL, l_de_2, 'admin'),
  ('tus_lichterfelde_de', 'TuS Lichterfelde', lower('TuS Lichterfelde'), c_de, NULL, NULL, l_de_2, 'admin'),
  ('hanauer_thc_de', '1. Hanauer THC', lower('1. Hanauer THC'), c_de, NULL, NULL, l_de_2, 'admin'),
  ('ruesselsheimer_de', 'Rüsselsheimer RK', lower('Rüsselsheimer RK'), c_de, NULL, NULL, l_de_2, 'admin'),
  ('rotation_prenz_de', 'SG Rotation Prenzlauer Berg', lower('SG Rotation Prenzlauer Berg'), c_de, NULL, NULL, l_de_2, 'admin'),

  -- England (8)
  ('beeston_en', 'Beeston HC', lower('Beeston HC'), c_en, NULL, l_en_1, NULL, 'admin'),
  ('brooklands_en', 'Brooklands Manchester University', lower('Brooklands Manchester University'), c_en, NULL, l_en_1, NULL, 'admin'),
  ('cardiff_met_en', 'Cardiff & Met HC', lower('Cardiff & Met HC'), c_en, NULL, l_en_1, NULL, 'admin'),
  ('old_georgians_en', 'Old Georgians HC', lower('Old Georgians HC'), c_en, NULL, l_en_1, NULL, 'admin'),
  ('oxted_en', 'Oxted HC', lower('Oxted HC'), c_en, NULL, l_en_1, NULL, 'admin'),
  ('southgate_en', 'Southgate HC', lower('Southgate HC'), c_en, NULL, l_en_1, NULL, 'admin'),
  ('barnes_en', 'Barnes HC', lower('Barnes HC'), c_en, NULL, NULL, l_en_1, 'admin'),
  ('durham_uni_en', 'Durham University HC', lower('Durham University HC'), c_en, NULL, NULL, l_en_1, 'admin'),

  -- Belgium (4)
  ('daring_be', 'Royal Daring HC', lower('Royal Daring HC'), c_be, NULL, l_be_nat1, NULL, 'admin'),
  ('namur_be', 'Hockey Namur (RHCN)', lower('Hockey Namur (RHCN)'), c_be, NULL, l_be_nat1, NULL, 'admin'),
  ('white_star_be', 'Royal Evere White Star HC', lower('Royal Evere White Star HC'), c_be, NULL, NULL, l_be_nat1, 'admin'),
  ('mechelse_be', 'KMTHC Mechelse', lower('KMTHC Mechelse'), c_be, NULL, NULL, l_be_nat1, 'admin'),

  -- Spain (19)
  ('san_vicente_es', 'UA-San Vicente', lower('UA-San Vicente'), c_es, NULL, l_es_b, l_es_b, 'admin'),
  ('rs_1927_es', 'Real Sociedad 1927', lower('Real Sociedad 1927'), c_es, NULL, l_es_b, NULL, 'admin'),
  ('sant_cugat_es', 'HC Sant Cugat', lower('HC Sant Cugat'), c_es, NULL, l_es_b, l_es_b, 'admin'),
  ('valles_esp_es', 'Vallès Esportiu', lower('Vallès Esportiu'), c_es, NULL, l_es_b, l_es_b, 'admin'),
  ('iluro_es', 'Iluro HC', lower('Iluro HC'), c_es, NULL, l_es_b, NULL, 'admin'),
  ('linia22_es', 'Linia 22 HC Stern Motor', lower('Linia 22 HC Stern Motor'), c_es, NULL, l_es_b, NULL, 'admin'),
  ('benalmadena_es', 'RH Privé Benalmádena', lower('RH Privé Benalmádena'), c_es, NULL, l_es_b, NULL, 'admin'),
  ('giner_rios_es', 'CD Giner de los Ríos', lower('CD Giner de los Ríos'), c_es, NULL, l_es_b, l_es_b, 'admin'),
  ('pedralbes_es', 'Pedralbes HC', lower('Pedralbes HC'), c_es, NULL, l_es_b, NULL, 'admin'),
  ('spv_es', 'SPV', lower('SPV'), c_es, NULL, l_es_b, NULL, 'admin'),
  ('carpesa_es', 'CH Carpesa', lower('CH Carpesa'), c_es, NULL, l_es_b, NULL, 'admin'),
  ('egara_1935_es', 'Egara 1935', lower('Egara 1935'), c_es, NULL, l_es_b, NULL, 'admin'),
  ('ad_rimas_es', 'AD Rimas', lower('AD Rimas'), c_es, NULL, l_es_b, NULL, 'admin'),
  ('pozuelo_es', 'CH Pozuelo', lower('CH Pozuelo'), c_es, NULL, NULL, l_es_b, 'admin'),
  ('carranque_es', 'Carranque Candelaria', lower('Carranque Candelaria'), c_es, NULL, NULL, l_es_b, 'admin'),
  ('xaloc_es', 'CH Xaloc', lower('CH Xaloc'), c_es, NULL, NULL, l_es_b, 'admin'),
  ('san_fernando_es', 'CH San Fernando', lower('CH San Fernando'), c_es, NULL, NULL, l_es_b, 'admin'),
  ('covadonga_es', 'RGC Covadonga', lower('RGC Covadonga'), c_es, NULL, NULL, l_es_b, 'admin'),
  ('valencia_ch_es', 'Valencia CH', lower('Valencia CH'), c_es, NULL, NULL, l_es_b, 'admin'),

  -- Italy (12)
  ('cus_cagliari_it', 'CUS Cagliari', lower('CUS Cagliari'), c_it, NULL, l_it_a1, l_it_a1, 'admin'),
  ('cus_padova_it', 'CUS Padova', lower('CUS Padova'), c_it, NULL, l_it_a1, l_it_a1, 'admin'),
  ('bondeno_it', 'Hockey Club Bondeno', lower('Hockey Club Bondeno'), c_it, NULL, l_it_a1, NULL, 'admin'),
  ('riva_it', 'Hockey Club Riva', lower('Hockey Club Riva'), c_it, NULL, l_it_a1, l_it_a1, 'admin'),
  ('uhc_adige_it', 'UHC Adige', lower('UHC Adige'), c_it, NULL, l_it_a1, NULL, 'admin'),
  ('san_giorgio_it', 'CSP San Giorgio', lower('CSP San Giorgio'), c_it, NULL, l_it_a1, NULL, 'admin'),
  ('cus_pisa_it', 'CUS Pisa', lower('CUS Pisa'), c_it, NULL, l_it_a1, l_it_a1, 'admin'),
  ('potenza_picena_it', 'Hockey Club Potenza Picena', lower('Hockey Club Potenza Picena'), c_it, NULL, l_it_a1, NULL, 'admin'),
  ('juvenilia_uras_it', 'Polisportiva Juvenilia Uras', lower('Polisportiva Juvenilia Uras'), c_it, NULL, l_it_a1, l_it_a1, 'admin'),
  ('paolo_bonomi_it', 'SH Paolo Bonomi', lower('SH Paolo Bonomi'), c_it, NULL, l_it_a1, NULL, 'admin'),
  ('argentia_it', 'HC Argentia', lower('HC Argentia'), c_it, NULL, NULL, l_it_a1, 'admin'),
  ('sardegna_uras_it', 'Hockey Team Sardegna (Uras)', lower('Hockey Team Sardegna (Uras)'), c_it, NULL, NULL, l_it_a1, 'admin'),

  -- New Zealand — Auckland (11)
  ('aisc_nz', 'AISC', lower('AISC'), c_nz, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('auckland_uni_nz', 'Auckland University', lower('Auckland University'), c_nz, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('grammar_windsor_nz', 'Grammar Windsor', lower('Grammar Windsor'), c_nz, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('howick_pakuranga_nz', 'Howick Pakuranga', lower('Howick Pakuranga'), c_nz, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('mt_eden_nz', 'Mt Eden', lower('Mt Eden'), c_nz, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('masters_women_nz', 'Masters Women', lower('Masters Women'), c_nz, p_auckland_id, NULL, l_auckland_id, 'admin'),
  ('roskill_eden_nz', 'Roskill Eden', lower('Roskill Eden'), c_nz, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('somerville_nz', 'Somerville', lower('Somerville'), c_nz, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('southern_districts_nz', 'Southern Districts', lower('Southern Districts'), c_nz, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('waitakere_nz', 'Waitakere', lower('Waitakere'), c_nz, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),
  ('western_districts_nz', 'Western Districts', lower('Western Districts'), c_nz, p_auckland_id, l_auckland_id, l_auckland_id, 'admin'),

  -- New Zealand — Otago (11)
  ('albany_nz', 'Albany Hockey Club', lower('Albany Hockey Club'), c_nz, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('city_highlanders_nz', 'City Highlanders Hockey Club', lower('City Highlanders Hockey Club'), c_nz, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('ketob_women_nz', 'KETOB Women', lower('KETOB Women'), c_nz, p_otago_id, NULL, l_otago_id, 'admin'),
  ('ketob_men_nz', 'KETOB Men', lower('KETOB Men'), c_nz, p_otago_id, l_otago_id, NULL, 'admin'),
  ('kings_united_nz', 'Kings United Hockey Club', lower('Kings United Hockey Club'), c_nz, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('momona_nz', 'Momona Hockey Club', lower('Momona Hockey Club'), c_nz, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('otago_uni_nz', 'Otago University Hockey Club', lower('Otago University Hockey Club'), c_nz, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('southland_barbarians_nz', 'Southland Barbarians Hockey Club', lower('Southland Barbarians Hockey Club'), c_nz, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('taieri_nz', 'Taieri Hockey Club', lower('Taieri Hockey Club'), c_nz, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('tainui_nz', 'Tainui Hockey Club', lower('Tainui Hockey Club'), c_nz, p_otago_id, l_otago_id, l_otago_id, 'admin'),
  ('west_taieri_nz', 'West Taieri Ladies Hockey Club', lower('West Taieri Ladies Hockey Club'), c_nz, p_otago_id, NULL, l_otago_id, 'admin'),

  -- Uruguay (16)
  ('bigua_uy', 'Club Biguá', lower('Club Biguá'), c_uy, NULL, NULL, l_uy_w1, 'admin'),
  ('carrasco_polo_uy', 'Carrasco Polo Club', lower('Carrasco Polo Club'), c_uy, NULL, NULL, l_uy_w1, 'admin'),
  ('nautico_carrasco_uy', 'Club Náutico de Carrasco y Punta Gorda', lower('Club Náutico de Carrasco y Punta Gorda'), c_uy, NULL, NULL, l_uy_w1, 'admin'),
  ('seminario_uy', 'Club Seminario', lower('Club Seminario'), c_uy, NULL, l_uy_m_id, l_uy_w1, 'admin'),
  ('ivy_thomas_uy', 'Ivy Thomas', lower('Ivy Thomas'), c_uy, NULL, NULL, l_uy_w1, 'admin'),
  ('obcyogc_uy', 'Old Boys & Old Girls Club (Old Girls Club)', lower('Old Boys & Old Girls Club (Old Girls Club)'), c_uy, NULL, NULL, l_uy_w1, 'admin'),
  ('old_sampa_uy', 'Old Sampa Club', lower('Old Sampa Club'), c_uy, NULL, NULL, l_uy_w1, 'admin'),
  ('old_woodlands_uy', 'Old Woodlands Club', lower('Old Woodlands Club'), c_uy, NULL, NULL, l_uy_w1, 'admin'),
  ('ycu_uy', 'Yacht Club Uruguayo', lower('Yacht Club Uruguayo'), c_uy, NULL, NULL, l_uy_w1, 'admin'),
  ('lobos_uy', 'Lobos Rugby Club', lower('Lobos Rugby Club'), c_uy, NULL, l_uy_m_id, l_uy_w2_id, 'admin'),
  ('old_brendans_uy', 'Old Brendan''s Club', lower('Old Brendan''s Club'), c_uy, NULL, NULL, l_uy_w2_id, 'admin'),
  ('ort_uy', 'Universidad ORT Uruguay', lower('Universidad ORT Uruguay'), c_uy, NULL, NULL, l_uy_w2_id, 'admin'),
  ('palo_pico_uy', 'Palo y Pico', lower('Palo y Pico'), c_uy, NULL, NULL, l_uy_w2_id, 'admin'),
  ('psg_uy', 'PSG (Pucaru Stade Gaulois)', lower('PSG (Pucaru Stade Gaulois)'), c_uy, NULL, l_uy_m_id, NULL, 'admin'),
  ('northfield_uy', 'Northfield Centro Deportivo', lower('Northfield Centro Deportivo'), c_uy, NULL, l_uy_m_id, NULL, 'admin'),
  ('jupave_uy', 'JUPAVE Hockey Club', lower('JUPAVE Hockey Club'), c_uy, NULL, l_uy_m_id, NULL, 'admin');

END $$;
