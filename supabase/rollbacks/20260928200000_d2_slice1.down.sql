-- ROLLBACK for the D2 slice-1 migrations 20260928200000 … 20260928240000.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Restores the exact pre-migration function bodies (verified md5-identical to
-- staging and production on 2026-09-26), drops everything D2 added, and
-- re-scores completeness with the old formula using the same
-- triggers-disabled backfill (no updated_at / version bumps).
-- DATA LOSS: player_work_permits rows are dropped. Dump them first:
--   pg_dump "$DB_URL" -t public.player_work_permits --data-only > permits.sql
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then, so the migration history matches:
--   supabase migration repair --status reverted 20260928200000 20260928210000 20260928220000 20260928230000 20260928240000 --linked

-- 20260928240000 · eligibility back to its own EU code list
CREATE OR REPLACE FUNCTION public.check_application_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_eu_required  boolean;
  v_opp_type     opportunity_type;
  v_opp_gender   opportunity_gender;
  v_nat1         integer;
  v_nat2         integer;
  v_user_gender  text;
  v_norm_gender  text;
  v_nat_count    int;
  v_eu_count     int;
  -- EU member state ISO 3166-1 alpha-2 codes. Mirrors EU_COUNTRY_CODES in
  -- client/src/hooks/useCountries.ts.
  v_eu_codes     text[] := ARRAY[
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
    'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'
  ];
BEGIN
  SELECT eu_passport_required, opportunity_type, gender
    INTO v_eu_required, v_opp_type, v_opp_gender
  FROM opportunities
  WHERE id = NEW.opportunity_id;

  -- Opportunity missing — let the FK constraint surface that, not us.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT nationality_country_id, nationality2_country_id, gender
    INTO v_nat1, v_nat2, v_user_gender
  FROM profiles
  WHERE id = NEW.applicant_id;

  -- ── Rule A — EU passport ──
  IF v_eu_required IS TRUE THEN
    SELECT count(*), count(*) FILTER (WHERE code = ANY (v_eu_codes))
      INTO v_nat_count, v_eu_count
    FROM countries
    WHERE id = v_nat1 OR id = v_nat2;

    -- Block only when the applicant HAS a nationality and none is EU.
    -- No nationality on file → allowed (the UI nudges them instead).
    IF v_nat_count > 0 AND v_eu_count = 0 THEN
      RAISE EXCEPTION 'This opportunity requires an EU passport.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── Rule B — gender / team category (player opportunities only) ──
  IF v_opp_type = 'player'
     AND v_opp_gender IS NOT NULL
     AND v_opp_gender <> 'Mixed' THEN
    v_norm_gender := lower(trim(coalesce(v_user_gender, '')));

    -- Empty gender → allowed (missing data never blocks).
    IF v_norm_gender <> '' THEN
      IF v_opp_gender IN ('Women', 'Girls')
         AND v_norm_gender IN ('men', 'man', 'male') THEN
        RAISE EXCEPTION 'This opportunity is for women''s teams.'
          USING ERRCODE = 'P0001';
      END IF;

      IF v_opp_gender IN ('Men', 'Boys')
         AND v_norm_gender IN ('women', 'woman', 'female') THEN
        RAISE EXCEPTION 'This opportunity is for men''s teams.'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 20260928230000 · search RPCs back to their previous bodies (grants unchanged)
CREATE OR REPLACE FUNCTION public.discover_profiles(p_roles text[] DEFAULT NULL::text[], p_positions text[] DEFAULT NULL::text[], p_gender text DEFAULT NULL::text, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_nationality_country_ids integer[] DEFAULT NULL::integer[], p_eu_passport boolean DEFAULT NULL::boolean, p_base_country_ids integer[] DEFAULT NULL::integer[], p_base_location text DEFAULT NULL::text, p_availability text DEFAULT NULL::text, p_min_references integer DEFAULT NULL::integer, p_min_career_entries integer DEFAULT NULL::integer, p_league_ids integer[] DEFAULT NULL::integer[], p_country_ids integer[] DEFAULT NULL::integer[], p_search_text text DEFAULT NULL::text, p_sort_by text DEFAULT 'relevance'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_coach_specializations text[] DEFAULT NULL::text[], p_target_category text DEFAULT NULL::text, p_relocation_willingness text DEFAULT NULL::text, p_relocation_to_country_ids integer[] DEFAULT NULL::integer[], p_level_target text DEFAULT NULL::text, p_opportunity_preference text DEFAULT NULL::text, p_available_by date DEFAULT NULL::date, p_specialist_skills text[] DEFAULT NULL::text[], p_required_positions text[] DEFAULT NULL::text[], p_exclude_paid_seekers boolean DEFAULT NULL::boolean, p_required_location_country_id integer DEFAULT NULL::integer, p_restrict_profile_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_eu_country_ids INT[];
  v_total BIGINT;
  v_results JSONB;
  v_effective_category TEXT;
  v_nationality_country_ids INT[] := expand_country_equivalents(p_nationality_country_ids);
  v_base_country_ids INT[] := expand_country_equivalents(p_base_country_ids);
  v_country_ids INT[] := expand_country_equivalents(p_country_ids);
  -- Relocation target is matched against the candidate's OPEN list (overlap)
  -- and rejected against their EXCLUDED list, with GB↔GB-ENG tolerance.
  v_relocation_ids INT[] := expand_country_equivalents(p_relocation_to_country_ids);
  -- Phase 3e — must-have location country (+ equivalents) for the NULL-neutral
  -- location filter below.
  v_required_location_ids INT[] := expand_country_equivalents(
    CASE WHEN p_required_location_country_id IS NULL THEN NULL
         ELSE ARRAY[p_required_location_country_id] END
  );
BEGIN
  IF p_eu_passport = true THEN
    SELECT ARRAY_AGG(id) INTO v_eu_country_ids
    FROM countries
    WHERE code IN (
      'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR',
      'DE','GR','HU','IE','IT','LV','LT','LU','MT','NL',
      'PL','PT','RO','SK','SI','ES','SE'
    );
  END IF;

  v_effective_category := COALESCE(
    p_target_category,
    CASE
      WHEN p_gender = 'Men' THEN 'adult_men'
      WHEN p_gender = 'Women' THEN 'adult_women'
      ELSE NULL
    END
  );

  SELECT COUNT(*) INTO v_total
  FROM profiles p
  LEFT JOIN world_clubs wc ON wc.id = p.current_world_club_id
  WHERE p.onboarding_completed = true
    AND (is_staging_env() OR p.is_test_account = false)
    AND p.is_blocked = false
    -- International experience (2026-07-27): nl-search pre-resolves
    -- verified/self-described profile ids from career_history and
    -- restricts here, keeping every fence in this function. NULL-neutral.
    AND (p_restrict_profile_ids IS NULL OR p.id = ANY(p_restrict_profile_ids))
    -- age-gate: layer-3 discovery fence (hidden or DOB-grace-lapsed persons)
    AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
    AND (p_roles IS NULL OR p.role = ANY(p_roles))
    AND (p_positions IS NULL OR p.position = ANY(p_positions) OR p.secondary_position = ANY(p_positions))
    AND (
      v_effective_category IS NULL
      OR CASE p.role
        WHEN 'player' THEN p.playing_category = v_effective_category
        WHEN 'coach'  THEN p.coaching_categories IS NOT NULL
                          AND (v_effective_category = ANY(p.coaching_categories)
                               OR 'any' = ANY(p.coaching_categories))
        WHEN 'umpire' THEN p.umpiring_categories IS NOT NULL
                          AND (v_effective_category = ANY(p.umpiring_categories)
                               OR 'any' = ANY(p.umpiring_categories))
        ELSE TRUE
      END
    )
    AND (p_min_age IS NULL OR p.date_of_birth IS NOT NULL
         AND p.date_of_birth <= CURRENT_DATE - (p_min_age * INTERVAL '1 year'))
    AND (p_max_age IS NULL OR p.date_of_birth IS NOT NULL
         AND p.date_of_birth >= CURRENT_DATE - ((p_max_age + 1) * INTERVAL '1 year'))
    AND (v_nationality_country_ids IS NULL
         OR p.nationality_country_id = ANY(v_nationality_country_ids)
         OR p.nationality2_country_id = ANY(v_nationality_country_ids))
    AND (p_eu_passport IS NULL OR p_eu_passport = false
         OR p.nationality_country_id = ANY(v_eu_country_ids)
         OR p.nationality2_country_id = ANY(v_eu_country_ids))
    AND (v_base_country_ids IS NULL
         OR p.base_country_id = ANY(v_base_country_ids)
         OR (p.base_country_id IS NULL
             AND (p.nationality_country_id = ANY(v_base_country_ids)
                  OR p.nationality2_country_id = ANY(v_base_country_ids))))
    AND (p_base_location IS NULL
         OR p.base_city ILIKE '%' || p_base_location || '%'
         OR p.base_location ILIKE '%' || p_base_location || '%')
    AND (p_availability IS NULL
         OR (p_availability = 'open_to_play' AND p.open_to_play = true)
         OR (p_availability = 'open_to_coach' AND p.open_to_coach = true)
         OR (p_availability = 'open_to_opportunities' AND p.open_to_opportunities = true))
    AND (p_min_references IS NULL OR p.accepted_reference_count >= p_min_references)
    AND (p_min_career_entries IS NULL OR p.career_entry_count >= p_min_career_entries)
    AND (p_league_ids IS NULL
         OR p.mens_league_id = ANY(p_league_ids)
         OR p.womens_league_id = ANY(p_league_ids))
    AND (v_country_ids IS NULL OR wc.country_id = ANY(v_country_ids))
    AND (p_coach_specializations IS NULL OR p.coach_specialization = ANY(p_coach_specializations))
    -- ── Phase 2 (2e) intent filters — NULL-neutral ──
    AND (p_relocation_willingness IS NULL OR p.relocation_willingness IS NULL
         OR p.relocation_willingness = p_relocation_willingness)
    AND (v_relocation_ids IS NULL
         OR COALESCE(array_length(p.relocation_countries_open, 1), 0) = 0
         OR p.relocation_countries_open && v_relocation_ids)
    AND (v_relocation_ids IS NULL
         OR NOT (COALESCE(p.relocation_countries_excluded, '{}') && v_relocation_ids))
    AND (p_level_target IS NULL OR p.level_target IS NULL
         OR p.level_target = p_level_target)
    AND (p_opportunity_preference IS NULL OR p.opportunity_preference IS NULL
         OR p.opportunity_preference = p_opportunity_preference)
    AND (p_available_by IS NULL OR p.available_from IS NULL
         OR p.available_from <= p_available_by)
    AND (p_specialist_skills IS NULL
         OR COALESCE(array_length(p.specialist_skills, 1), 0) = 0
         OR p.specialist_skills && p_specialist_skills)
    -- ── Phase 3e MUST-HAVE filters — NULL-neutral (blank candidate kept) ──
    AND (p_required_positions IS NULL
         OR (p.position IS NULL AND p.secondary_position IS NULL)
         OR p.position = ANY(p_required_positions)
         OR p.secondary_position = ANY(p_required_positions))
    AND (p_exclude_paid_seekers IS NULL OR p_exclude_paid_seekers = false
         OR p.opportunity_preference IS NULL
         OR p.opportunity_preference <> 'paid')
    AND (v_required_location_ids IS NULL
         OR (NOT (COALESCE(p.relocation_countries_excluded, '{}') && v_required_location_ids)
             AND NOT (COALESCE(p.relocation_willingness = 'home_only', false)
                      AND COALESCE(p.base_country_id, p.nationality_country_id) IS NOT NULL
                      AND NOT (COALESCE(p.base_country_id, p.nationality_country_id) = ANY(v_required_location_ids)))))
    AND (p_search_text IS NULL
         OR p.search_vector @@ plainto_tsquery('english', p_search_text));

  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb) INTO v_results
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'username', p.username,
      'avatar_url', p.avatar_url,
      'role', p.role,
      'position', p.position,
      'secondary_position', p.secondary_position,
      'gender', p.gender,
      'playing_category', p.playing_category,
      'coaching_categories', p.coaching_categories,
      'umpiring_categories', p.umpiring_categories,
      'age', CASE
        WHEN p.date_of_birth IS NOT NULL
        THEN EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_of_birth))::INT
        ELSE NULL
      END,
      'nationality_country_id', p.nationality_country_id,
      'nationality2_country_id', p.nationality2_country_id,
      'nationality_name', cn1.nationality_name,
      'nationality2_name', cn2.nationality_name,
      'flag_emoji', cn1.flag_emoji,
      'flag_emoji2', cn2.flag_emoji,
      'base_location', COALESCE(p.base_city, p.base_location),
      'base_country_name', cnb.name,
      'current_club', p.current_club,
      'current_world_club_id', p.current_world_club_id,
      'open_to_play', p.open_to_play,
      'open_to_coach', p.open_to_coach,
      'open_to_opportunities', p.open_to_opportunities,
      'accepted_reference_count', p.accepted_reference_count,
      'career_entry_count', p.career_entry_count,
      'accepted_friend_count', p.accepted_friend_count,
      'last_active_at', p.last_active_at,
      'coach_specialization', p.coach_specialization,
      'coach_specialization_custom', p.coach_specialization_custom,
      -- Phase 2 (2e) — surface the matched intent so result cards / AI can cite it.
      'relocation_willingness', p.relocation_willingness,
      'level_target', p.level_target,
      'opportunity_preference', p.opportunity_preference,
      'available_from', p.available_from,
      'specialist_skills', p.specialist_skills
    ) AS row_data
    FROM profiles p
    LEFT JOIN countries cn1 ON cn1.id = p.nationality_country_id
    LEFT JOIN countries cn2 ON cn2.id = p.nationality2_country_id
    LEFT JOIN countries cnb ON cnb.id = p.base_country_id
    LEFT JOIN world_clubs wc ON wc.id = p.current_world_club_id
    WHERE p.onboarding_completed = true
      AND (is_staging_env() OR p.is_test_account = false)
      AND p.is_blocked = false
      -- International experience (2026-07-27): nl-search pre-resolves
      -- verified/self-described profile ids from career_history and
      -- restricts here, keeping every fence in this function. NULL-neutral.
      AND (p_restrict_profile_ids IS NULL OR p.id = ANY(p_restrict_profile_ids))
      -- age-gate: layer-3 discovery fence (mirror the COUNT)
      AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
      AND (p_roles IS NULL OR p.role = ANY(p_roles))
      AND (p_positions IS NULL OR p.position = ANY(p_positions) OR p.secondary_position = ANY(p_positions))
      AND (
        v_effective_category IS NULL
        OR CASE p.role
          WHEN 'player' THEN p.playing_category = v_effective_category
          WHEN 'coach'  THEN p.coaching_categories IS NOT NULL
                            AND (v_effective_category = ANY(p.coaching_categories)
                                 OR 'any' = ANY(p.coaching_categories))
          WHEN 'umpire' THEN p.umpiring_categories IS NOT NULL
                            AND (v_effective_category = ANY(p.umpiring_categories)
                                 OR 'any' = ANY(p.umpiring_categories))
          ELSE TRUE
        END
      )
      AND (p_min_age IS NULL OR p.date_of_birth IS NOT NULL
           AND p.date_of_birth <= CURRENT_DATE - (p_min_age * INTERVAL '1 year'))
      AND (p_max_age IS NULL OR p.date_of_birth IS NOT NULL
           AND p.date_of_birth >= CURRENT_DATE - ((p_max_age + 1) * INTERVAL '1 year'))
      AND (v_nationality_country_ids IS NULL
           OR p.nationality_country_id = ANY(v_nationality_country_ids)
           OR p.nationality2_country_id = ANY(v_nationality_country_ids))
      AND (p_eu_passport IS NULL OR p_eu_passport = false
           OR p.nationality_country_id = ANY(v_eu_country_ids)
           OR p.nationality2_country_id = ANY(v_eu_country_ids))
      AND (v_base_country_ids IS NULL
           OR p.base_country_id = ANY(v_base_country_ids)
           OR (p.base_country_id IS NULL
               AND (p.nationality_country_id = ANY(v_base_country_ids)
                    OR p.nationality2_country_id = ANY(v_base_country_ids))))
      AND (p_base_location IS NULL
           OR p.base_city ILIKE '%' || p_base_location || '%'
           OR p.base_location ILIKE '%' || p_base_location || '%')
      AND (p_availability IS NULL
           OR (p_availability = 'open_to_play' AND p.open_to_play = true)
           OR (p_availability = 'open_to_coach' AND p.open_to_coach = true)
           OR (p_availability = 'open_to_opportunities' AND p.open_to_opportunities = true))
      AND (p_min_references IS NULL OR p.accepted_reference_count >= p_min_references)
      AND (p_min_career_entries IS NULL OR p.career_entry_count >= p_min_career_entries)
      AND (p_league_ids IS NULL
           OR p.mens_league_id = ANY(p_league_ids)
           OR p.womens_league_id = ANY(p_league_ids))
      AND (v_country_ids IS NULL OR wc.country_id = ANY(v_country_ids))
      AND (p_coach_specializations IS NULL OR p.coach_specialization = ANY(p_coach_specializations))
      -- ── Phase 2 (2e) intent filters — NULL-neutral (mirror the COUNT) ──
      AND (p_relocation_willingness IS NULL OR p.relocation_willingness IS NULL
           OR p.relocation_willingness = p_relocation_willingness)
      AND (v_relocation_ids IS NULL
           OR COALESCE(array_length(p.relocation_countries_open, 1), 0) = 0
           OR p.relocation_countries_open && v_relocation_ids)
      AND (v_relocation_ids IS NULL
           OR NOT (COALESCE(p.relocation_countries_excluded, '{}') && v_relocation_ids))
      AND (p_level_target IS NULL OR p.level_target IS NULL
           OR p.level_target = p_level_target)
      AND (p_opportunity_preference IS NULL OR p.opportunity_preference IS NULL
           OR p.opportunity_preference = p_opportunity_preference)
      AND (p_available_by IS NULL OR p.available_from IS NULL
           OR p.available_from <= p_available_by)
      AND (p_specialist_skills IS NULL
           OR COALESCE(array_length(p.specialist_skills, 1), 0) = 0
           OR p.specialist_skills && p_specialist_skills)
      -- ── Phase 3e MUST-HAVE filters — NULL-neutral (mirror the COUNT) ──
      AND (p_required_positions IS NULL
           OR (p.position IS NULL AND p.secondary_position IS NULL)
           OR p.position = ANY(p_required_positions)
           OR p.secondary_position = ANY(p_required_positions))
      AND (p_exclude_paid_seekers IS NULL OR p_exclude_paid_seekers = false
           OR p.opportunity_preference IS NULL
           OR p.opportunity_preference <> 'paid')
      AND (v_required_location_ids IS NULL
           OR (NOT (COALESCE(p.relocation_countries_excluded, '{}') && v_required_location_ids)
               AND NOT (p.relocation_willingness = 'home_only'
                        AND COALESCE(p.base_country_id, p.nationality_country_id) IS NOT NULL
                        AND NOT (COALESCE(p.base_country_id, p.nationality_country_id) = ANY(v_required_location_ids)))))
      AND (p_search_text IS NULL
           OR p.search_vector @@ plainto_tsquery('english', p_search_text))
    ORDER BY
      CASE p_sort_by
        WHEN 'newest' THEN NULL
        WHEN 'most_referenced' THEN NULL
        WHEN 'recently_active' THEN NULL
        ELSE NULL
      END,
      CASE WHEN p_sort_by = 'most_referenced'
        THEN p.accepted_reference_count END DESC NULLS LAST,
      CASE WHEN p_sort_by = 'recently_active'
        THEN p.last_active_at END DESC NULLS LAST,
      CASE WHEN p_sort_by = 'relevance' AND p_search_text IS NOT NULL
        THEN ts_rank(p.search_vector, plainto_tsquery('english', p_search_text)) END DESC NULLS LAST,
      p.profile_completeness_pct DESC NULLS LAST,
      p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'results', v_results,
    'total', v_total,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_search_members(p_role text DEFAULT NULL::text, p_positions text[] DEFAULT NULL::text[], p_coach_specializations text[] DEFAULT NULL::text[], p_categories text[] DEFAULT NULL::text[], p_officiating_specializations text[] DEFAULT NULL::text[], p_nationality_country_ids integer[] DEFAULT NULL::integer[], p_eu_required boolean DEFAULT NULL::boolean, p_location_country_ids integer[] DEFAULT NULL::integer[], p_location_text text DEFAULT NULL::text, p_availability_open boolean DEFAULT NULL::boolean, p_brand_category text DEFAULT NULL::text, p_search_text text DEFAULT NULL::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0, p_open_opportunity_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total BIGINT;
  v_results JSONB;
  v_eu_country_ids INT[] := eu_country_ids();
  v_nationality_ids INT[] := expand_country_equivalents(p_nationality_country_ids);
  v_location_ids INT[] := expand_country_equivalents(p_location_country_ids);
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM profiles p
  LEFT JOIN brands b ON b.profile_id = p.id
  WHERE p.onboarding_completed = true
    AND (is_staging_env() OR p.is_test_account = false)
    AND p.is_blocked = false
    -- age-gate: layer-3 discovery fence (hidden or DOB-grace-lapsed persons)
    AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
    AND (p_role IS NULL OR p.role = p_role)
    AND (p_brand_category IS NULL OR (p.role = 'brand' AND b.category = p_brand_category))
    AND (p_positions IS NULL
         OR lower(p.position) = ANY(p_positions)
         OR lower(p.secondary_position) = ANY(p_positions))
    AND (p_coach_specializations IS NULL
         OR (p.role = 'coach' AND p.coach_specialization = ANY(p_coach_specializations)))
    AND (p_categories IS NULL OR CASE p.role
           WHEN 'player' THEN p.playing_category = ANY(p_categories)
           WHEN 'coach'  THEN p.coaching_categories IS NOT NULL
                             AND ('any' = ANY(p.coaching_categories) OR p.coaching_categories && p_categories)
           WHEN 'umpire' THEN p.umpiring_categories IS NOT NULL
                             AND ('any' = ANY(p.umpiring_categories) OR p.umpiring_categories && p_categories)
           ELSE FALSE
         END)
    AND (p_officiating_specializations IS NULL
         OR (p.role = 'umpire' AND p.officiating_specialization = ANY(p_officiating_specializations)))
    AND (v_nationality_ids IS NULL
         OR p.nationality_country_id = ANY(v_nationality_ids)
         OR p.nationality2_country_id = ANY(v_nationality_ids))
    AND (p_eu_required IS NULL OR p_eu_required = false
         OR (p.nationality_country_id IS NULL AND p.nationality2_country_id IS NULL)
         OR p.nationality_country_id = ANY(v_eu_country_ids)
         OR p.nationality2_country_id = ANY(v_eu_country_ids))
    AND (v_location_ids IS NULL
         OR COALESCE(p.base_country_id, b.country_id) = ANY(v_location_ids)
         OR EXISTS (SELECT 1 FROM countries c
                    WHERE c.id = ANY(v_location_ids)
                      AND p.base_location IS NOT NULL
                      AND (p.base_location ILIKE '%' || c.name || '%'
                           OR (c.common_name IS NOT NULL AND p.base_location ILIKE '%' || c.common_name || '%'))))
    AND (p_location_text IS NULL OR p.base_location ILIKE '%' || p_location_text || '%')
    AND (p_availability_open IS NULL OR p_availability_open = false OR CASE p.role
           WHEN 'player' THEN p.open_to_play
           WHEN 'coach'  THEN p.open_to_coach
           WHEN 'umpire' THEN p.available_for_appointments
           ELSE p.open_to_opportunities
         END = true)
    AND (p_search_text IS NULL OR p.search_vector @@ plainto_tsquery('english', p_search_text))
    AND (p_open_opportunity_type IS NULL
         OR (p.role <> 'club' OR EXISTS (
              SELECT 1 FROM opportunities o
              WHERE o.club_id = p.id AND o.status = 'open'
                AND (p_open_opportunity_type = 'any'
                     OR o.opportunity_type = p_open_opportunity_type::opportunity_type))));

  SELECT COALESCE(jsonb_agg(to_jsonb(sub) ORDER BY sub.created_at DESC), '[]'::jsonb) INTO v_results
  FROM (
    SELECT
      p.id, p.avatar_url, p.full_name, p.role, p.nationality, p.nationality_country_id,
      p.nationality2_country_id, p.base_location, p.position, p.secondary_position, p.current_club,
      p.current_world_club_id, p.gender, p.playing_category, p.coaching_categories, p.umpiring_categories,
      p.created_at, p.is_test_account, p.open_to_play, p.open_to_coach, p.open_to_opportunities,
      p.last_active_at, p.accepted_reference_count, p.coach_specialization, p.coach_specialization_custom,
      p.base_country_id, p.relocation_willingness, p.relocation_countries_open, p.relocation_countries_excluded,
      p.available_from, p.level_target, p.opportunity_preference, p.specialist_skills, p.highlight_video_url,
      p.full_game_video_count, p.bio, p.club_bio, p.year_founded, p.website, p.career_entry_count,
      p.accepted_friend_count, p.is_verified, p.verified_at, p.umpire_level, p.federation, p.umpire_since,
      p.officiating_specialization, p.languages, p.last_officiated_at, p.umpire_appointment_count,
      p.available_for_appointments, p.profile_completeness_pct
    FROM profiles p
    LEFT JOIN brands b ON b.profile_id = p.id
    WHERE p.onboarding_completed = true
      AND (is_staging_env() OR p.is_test_account = false)
      AND p.is_blocked = false
      -- age-gate: layer-3 discovery fence (mirror the COUNT)
      AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
      AND (p_role IS NULL OR p.role = p_role)
      AND (p_brand_category IS NULL OR (p.role = 'brand' AND b.category = p_brand_category))
      AND (p_positions IS NULL
           OR lower(p.position) = ANY(p_positions)
           OR lower(p.secondary_position) = ANY(p_positions))
      AND (p_coach_specializations IS NULL
           OR (p.role = 'coach' AND p.coach_specialization = ANY(p_coach_specializations)))
      AND (p_categories IS NULL OR CASE p.role
             WHEN 'player' THEN p.playing_category = ANY(p_categories)
             WHEN 'coach'  THEN p.coaching_categories IS NOT NULL
                               AND ('any' = ANY(p.coaching_categories) OR p.coaching_categories && p_categories)
             WHEN 'umpire' THEN p.umpiring_categories IS NOT NULL
                               AND ('any' = ANY(p.umpiring_categories) OR p.umpiring_categories && p_categories)
             ELSE FALSE
           END)
      AND (p_officiating_specializations IS NULL
           OR (p.role = 'umpire' AND p.officiating_specialization = ANY(p_officiating_specializations)))
      AND (v_nationality_ids IS NULL
           OR p.nationality_country_id = ANY(v_nationality_ids)
           OR p.nationality2_country_id = ANY(v_nationality_ids))
      AND (p_eu_required IS NULL OR p_eu_required = false
           OR (p.nationality_country_id IS NULL AND p.nationality2_country_id IS NULL)
           OR p.nationality_country_id = ANY(v_eu_country_ids)
           OR p.nationality2_country_id = ANY(v_eu_country_ids))
      AND (v_location_ids IS NULL
           OR COALESCE(p.base_country_id, b.country_id) = ANY(v_location_ids)
           OR EXISTS (SELECT 1 FROM countries c
                      WHERE c.id = ANY(v_location_ids)
                        AND p.base_location IS NOT NULL
                        AND (p.base_location ILIKE '%' || c.name || '%'
                             OR (c.common_name IS NOT NULL AND p.base_location ILIKE '%' || c.common_name || '%'))))
      AND (p_location_text IS NULL OR p.base_location ILIKE '%' || p_location_text || '%')
      AND (p_availability_open IS NULL OR p_availability_open = false OR CASE p.role
             WHEN 'player' THEN p.open_to_play
             WHEN 'coach'  THEN p.open_to_coach
             WHEN 'umpire' THEN p.available_for_appointments
             ELSE p.open_to_opportunities
           END = true)
      AND (p_search_text IS NULL OR p.search_vector @@ plainto_tsquery('english', p_search_text))
      AND (p_open_opportunity_type IS NULL
           OR (p.role <> 'club' OR EXISTS (
                SELECT 1 FROM opportunities o
                WHERE o.club_id = p.id AND o.status = 'open'
                  AND (p_open_opportunity_type = 'any'
                       OR o.opportunity_type = p_open_opportunity_type::opportunity_type))))
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN jsonb_build_object(
    'results', v_results,
    'total', v_total,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_top_community_members(p_role text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_sort text DEFAULT 'completeness'::text, p_only_open boolean DEFAULT false)
 RETURNS TABLE(id uuid, role text, full_name text, username text, avatar_url text, nationality text, nationality_country_id integer, nationality2_country_id integer, base_location text, "position" text, current_club text, current_world_club_id uuid, open_to_play boolean, open_to_coach boolean, open_to_opportunities boolean, is_verified boolean, last_active_at timestamp with time zone, profile_completeness_pct smallint, accepted_reference_count integer, career_entry_count integer, accepted_friend_count integer, playing_category text, gender text, competition_level_band integer, current_competition_name text, coach_specialization text, coaching_categories text[], highlight_video_url text, full_game_video_count integer, relocation_willingness text, relocation_countries_open integer[], relocation_countries_excluded integer[], available_from date, base_country_id integer, level_target text, opportunity_preference text, available_for_appointments boolean, bio text, umpire_level text, federation text, year_founded integer, secondary_position text, specialist_skills text[], umpiring_categories text[], verified_at timestamp with time zone, umpire_since smallint, officiating_specialization text, languages text[], last_officiated_at date, coach_specialization_custom text, club_bio text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.role::TEXT,
    p.full_name,
    p.username,
    p.avatar_url,
    p.nationality,
    p.nationality_country_id,
    p.nationality2_country_id,
    p.base_location,
    p.position,
    p.current_club,
    p.current_world_club_id::UUID,
    p.open_to_play,
    p.open_to_coach,
    p.open_to_opportunities,
    p.is_verified,
    p.last_active_at,
    p.profile_completeness_pct,
    p.accepted_reference_count,
    p.career_entry_count,
    p.accepted_friend_count,
    p.playing_category::TEXT,
    p.gender::TEXT,
    CASE
      WHEN p.playing_category IN ('adult_men', 'boys') THEN
        COALESCE(wl_m.level_band_global, wl_w.level_band_global)
      WHEN p.playing_category IN ('adult_women', 'girls') THEN
        COALESCE(wl_w.level_band_global, wl_m.level_band_global)
      ELSE
        COALESCE(wl_w.level_band_global, wl_m.level_band_global)
    END AS competition_level_band,
    CASE
      WHEN p.playing_category IN ('adult_men', 'boys') THEN
        COALESCE(wl_m.name, wl_w.name)
      WHEN p.playing_category IN ('adult_women', 'girls') THEN
        COALESCE(wl_w.name, wl_m.name)
      ELSE
        COALESCE(wl_w.name, wl_m.name)
    END AS current_competition_name,
    p.coach_specialization::TEXT,
    p.coaching_categories,
    p.highlight_video_url,
    p.full_game_video_count,
    p.relocation_willingness,
    p.relocation_countries_open,
    p.relocation_countries_excluded,
    p.available_from,
    p.base_country_id,
    p.level_target,
    p.opportunity_preference,
    p.available_for_appointments,
    p.bio,
    p.umpire_level,
    p.federation,
    p.year_founded,
    p.secondary_position,
    p.specialist_skills,
    p.umpiring_categories,
    p.verified_at,
    -- Role-specific Preview parity
    p.umpire_since,
    p.officiating_specialization,
    p.languages,
    p.last_officiated_at,
    p.coach_specialization_custom,
    p.club_bio
  FROM public.profiles p
  LEFT JOIN public.world_clubs wc ON wc.id = p.current_world_club_id
  LEFT JOIN public.world_leagues wl_m ON wl_m.id = wc.men_league_id
  LEFT JOIN public.world_leagues wl_w ON wl_w.id = wc.women_league_id
  WHERE p.onboarding_completed = TRUE
    AND COALESCE(p.is_blocked, FALSE) = FALSE
    -- age-gate: layer-3 discovery fence (hidden or DOB-grace-lapsed persons)
    AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
    AND COALESCE(p.is_test_account, FALSE) = FALSE
    AND (p_role IS NULL OR p.role = p_role)
    AND (p_role IS NOT NULL OR p.role <> 'brand')
    AND (
      NOT p_only_open
      OR COALESCE(p.open_to_play, FALSE)
      OR COALESCE(p.open_to_coach, FALSE)
      OR COALESCE(p.open_to_opportunities, FALSE)
      OR COALESCE(p.available_for_appointments, FALSE)
    )
  ORDER BY
    CASE WHEN p_sort = 'availability_activity' THEN
      (COALESCE(p.open_to_play, FALSE)
        OR COALESCE(p.open_to_coach, FALSE)
        OR COALESCE(p.open_to_opportunities, FALSE)
        OR COALESCE(p.available_for_appointments, FALSE))::int
    ELSE 0 END DESC,
    CASE WHEN p_sort = 'availability_activity' THEN p.last_active_at END
      DESC NULLS LAST,
    CASE WHEN p_sort = 'recently_joined' THEN p.created_at END
      DESC NULLS LAST,
    p.profile_completeness_pct DESC,
    p.last_active_at DESC NULLS LAST,
    (p.avatar_url IS NOT NULL) DESC,
    (p.current_club IS NOT NULL) DESC,
    (COALESCE(p.accepted_reference_count, 0) > 0) DESC,
    (COALESCE(p.open_to_play, FALSE)
      OR COALESCE(p.open_to_coach, FALSE)
      OR COALESCE(p.open_to_opportunities, FALSE)
      OR COALESCE(p.available_for_appointments, FALSE)) DESC,
    p.id
  LIMIT GREATEST(1, LEAST(p_limit, 100));
$function$;

-- 20260928220000 · completeness back to the previous formula
DROP TRIGGER IF EXISTS trg_player_videos_sync_completeness ON public.player_videos;
DROP TRIGGER IF EXISTS trg_player_work_permits_sync_completeness ON public.player_work_permits;
DROP FUNCTION IF EXISTS public.sync_completeness_from_player_videos();
DROP FUNCTION IF EXISTS public.sync_completeness_from_work_permits();
DROP FUNCTION IF EXISTS public.get_my_profile_completeness();
CREATE OR REPLACE FUNCTION public.compute_profile_completeness_pct(p public.profiles)
RETURNS SMALLINT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_score INTEGER := 0;
  b RECORD;
BEGIN
  IF p.role IS NULL THEN
    RETURN 0;
  END IF;

  IF p.role = 'player' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.position IS NOT NULL AND length(btrim(p.position)) > 0 THEN v_score := v_score + 5; END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN v_score := v_score + 5; END IF;
    IF p.current_club IS NOT NULL AND length(btrim(p.current_club)) > 0 THEN v_score := v_score + 5; END IF;
    IF p.highlight_video_url IS NOT NULL AND length(btrim(p.highlight_video_url)) > 0 THEN v_score := v_score + 15; END IF;
    IF COALESCE(p.full_game_video_count, 0) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.gallery_photo_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF p.open_to_play = TRUE THEN v_score := v_score + 5; END IF;

  ELSIF p.role = 'coach' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.coaching_categories IS NOT NULL AND array_length(p.coaching_categories, 1) > 0)
       OR (p.coach_specialization IS NOT NULL AND length(btrim(p.coach_specialization)) > 0) THEN v_score := v_score + 10; END IF;
    IF p.current_club IS NOT NULL AND length(btrim(p.current_club)) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF COALESCE(p.gallery_photo_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF p.open_to_coach = TRUE THEN v_score := v_score + 10; END IF;

  ELSIF p.role = 'club' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 15; END IF;
    IF (p.club_bio IS NOT NULL AND length(btrim(p.club_bio)) > 0)
       OR (p.bio IS NOT NULL AND length(btrim(p.bio)) > 0) THEN v_score := v_score + 20; END IF;
    IF p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.nationality_country_id IS NOT NULL THEN v_score := v_score + 5; END IF;
    IF p.year_founded IS NOT NULL THEN v_score := v_score + 10; END IF;
    IF (p.contact_email IS NOT NULL AND length(btrim(p.contact_email)) > 0 AND p.contact_email_public = TRUE)
       OR (p.website IS NOT NULL AND length(btrim(p.website)) > 0) THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.club_media_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF COALESCE(p.post_count, 0) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;

  ELSIF p.role = 'umpire' THEN
    IF p.avatar_url IS NOT NULL AND length(btrim(p.avatar_url)) > 0 THEN v_score := v_score + 10; END IF;
    IF p.bio IS NOT NULL AND length(btrim(p.bio)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.nationality_country_id IS NOT NULL
        OR (p.nationality IS NOT NULL AND length(btrim(p.nationality)) > 0))
       AND p.base_location IS NOT NULL AND length(btrim(p.base_location)) > 0 THEN v_score := v_score + 10; END IF;
    IF (p.umpire_level IS NOT NULL AND length(btrim(p.umpire_level)) > 0)
       OR (p.umpiring_categories IS NOT NULL AND array_length(p.umpiring_categories, 1) > 0) THEN v_score := v_score + 10; END IF;
    IF p.federation IS NOT NULL AND length(btrim(p.federation)) > 0 THEN v_score := v_score + 5; END IF;
    IF p.officiating_specialization IS NOT NULL AND length(btrim(p.officiating_specialization)) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.career_entry_count, 0) > 0 THEN v_score := v_score + 10; END IF;
    IF COALESCE(p.gallery_photo_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_friend_count, 0) > 0 THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.accepted_reference_count, 0) > 0 THEN v_score := v_score + 15; END IF;
    IF p.available_for_appointments = TRUE THEN v_score := v_score + 5; END IF;
    IF COALESCE(p.umpire_appointment_count, 0) > 0 THEN v_score := v_score + 10; END IF;

  ELSIF p.role = 'brand' THEN
    -- Brand identity lives in the brands table (the brand owner edits it
    -- there), NOT on profiles. Read the active brand row.
    -- Only real brands columns (product_count lives in a view, not the table).
    SELECT br.logo_url, br.bio, br.website_url, br.instagram_url, br.country_id,
           COALESCE(br.ambassador_count, 0) AS ambassador_count
      INTO b
      FROM public.brands br
      WHERE br.profile_id = p.id AND br.deleted_at IS NULL
      LIMIT 1;
    IF FOUND THEN
      IF b.logo_url IS NOT NULL AND length(btrim(b.logo_url)) > 0 THEN v_score := v_score + 20; END IF;
      IF b.bio IS NOT NULL AND length(btrim(b.bio)) > 0 THEN v_score := v_score + 20; END IF;
      IF (b.website_url IS NOT NULL AND length(btrim(b.website_url)) > 0)
         OR (b.instagram_url IS NOT NULL AND length(btrim(b.instagram_url)) > 0) THEN v_score := v_score + 20; END IF;
      IF b.country_id IS NOT NULL THEN v_score := v_score + 20; END IF;
      IF b.ambassador_count > 0 THEN v_score := v_score + 20; END IF;
    END IF;
  END IF;

  IF v_score < 0 THEN v_score := 0; END IF;
  IF v_score > 100 THEN v_score := 100; END IF;
  RETURN v_score;
END;
$$;
ALTER FUNCTION public.compute_profile_completeness_pct(public.profiles) RESET search_path;
DROP FUNCTION IF EXISTS public.player_completeness_parts(public.profiles);

-- 20260928210000 · age predicates, Open to play, own league
DROP TRIGGER IF EXISTS trg_guard_open_to_play_minor ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_open_to_play_minor();
DROP FUNCTION IF EXISTS public.set_open_to_play(boolean, date, text);
DROP FUNCTION IF EXISTS public.can_toggle_open_to_play(uuid);
DROP FUNCTION IF EXISTS public.is_suggestible(uuid);
DROP FUNCTION IF EXISTS public.profile_has_eu_passport(uuid);
DROP FUNCTION IF EXISTS public.player_league(uuid);
DROP FUNCTION IF EXISTS public.profile_is_suggestible(text, date, boolean, boolean, timestamptz);
DROP FUNCTION IF EXISTS public.profile_is_adult(date);

-- 20260928200000 · permits
DROP TABLE IF EXISTS public.player_work_permits;
DROP FUNCTION IF EXISTS public.guard_player_work_permit_client_write();
DROP FUNCTION IF EXISTS public.work_permit_status(date, date, date);

-- Re-score every profile with the restored formula, profile UPDATE triggers paused.
DO $backfill$
DECLARE
  r        record;
  v_saved  jsonb := '[]'::jsonb;
  v_rows   integer;
BEGIN
  -- tgtype bit 16 = fires on UPDATE. Internal (FK / constraint) triggers are left alone.
  FOR r IN
    SELECT t.tgname, t.tgenabled
      FROM pg_trigger t
     WHERE t.tgrelid = 'public.profiles'::regclass
       AND NOT t.tgisinternal
       AND (t.tgtype & 16) <> 0
       AND t.tgenabled <> 'D'
  LOOP
    v_saved := v_saved || jsonb_build_object('name', r.tgname, 'state', r.tgenabled::text);
    EXECUTE format('ALTER TABLE public.profiles DISABLE TRIGGER %I', r.tgname);
  END LOOP;

  UPDATE public.profiles p
     SET profile_completeness_pct = public.compute_profile_completeness_pct(p)
   WHERE p.profile_completeness_pct IS DISTINCT FROM public.compute_profile_completeness_pct(p);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  FOR r IN SELECT x->>'name' AS name, x->>'state' AS state FROM jsonb_array_elements(v_saved) x LOOP
    EXECUTE format('ALTER TABLE public.profiles %s TRIGGER %I',
      CASE r.state WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'ENABLE' END,
      r.name);
  END LOOP;

  RAISE NOTICE 'D2 completeness backfill: % rows re-scored, % UPDATE triggers paused and restored',
    v_rows, jsonb_array_length(v_saved);
END
$backfill$;
