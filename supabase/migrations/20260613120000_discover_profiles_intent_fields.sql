-- ============================================================================
-- Phase 2 (2e) — wire candidate intent into nl-search's discover_profiles RPC
-- ============================================================================
-- The Interested-lens intent fields (relocation_willingness, relocation
-- countries, level_target, opportunity_preference, available_from,
-- specialist_skills) existed on profiles + drove the recruiter verdict, but
-- nl-search could not filter on them. This adds six NULL-NEUTRAL filters so a
-- query like "players open to relocating to Spain, available in January, drag
-- flickers" narrows correctly WITHOUT excluding candidates who simply left a
-- field blank (the matching model's "missing data stays neutral" rule).
--
-- NULL-neutral means: a filter only EXCLUDES a profile that EXPLICITLY opted
-- the other way (a declared mismatch, or a relocation-excluded target country).
-- Blank / empty intent is always included.
--
-- Signature gains 6 trailing params (all DEFAULT NULL) so existing callers
-- keep working. Body is otherwise the byte-for-byte 20260525040000 body with
-- the new WHERE clauses in BOTH the COUNT and the SELECT, plus the intent
-- columns added to the projection.

set check_function_bodies = off;
set search_path = public;

-- Drop the prior 20-arg signature so the new 26-arg one is the ONLY overload.
-- Two overloads → PostgREST named-param calls raise "could not choose best
-- candidate function" (the disambiguation hazard index.ts already works around).
DROP FUNCTION IF EXISTS public.discover_profiles(
  text[], text[], text, integer, integer, integer[], boolean, integer[], text, text,
  integer, integer, integer[], integer[], text, text, integer, integer, text[], text
);

CREATE OR REPLACE FUNCTION public.discover_profiles(
  p_roles text[] DEFAULT NULL::text[],
  p_positions text[] DEFAULT NULL::text[],
  p_gender text DEFAULT NULL::text,
  p_min_age integer DEFAULT NULL::integer,
  p_max_age integer DEFAULT NULL::integer,
  p_nationality_country_ids integer[] DEFAULT NULL::integer[],
  p_eu_passport boolean DEFAULT NULL::boolean,
  p_base_country_ids integer[] DEFAULT NULL::integer[],
  p_base_location text DEFAULT NULL::text,
  p_availability text DEFAULT NULL::text,
  p_min_references integer DEFAULT NULL::integer,
  p_min_career_entries integer DEFAULT NULL::integer,
  p_league_ids integer[] DEFAULT NULL::integer[],
  p_country_ids integer[] DEFAULT NULL::integer[],
  p_search_text text DEFAULT NULL::text,
  p_sort_by text DEFAULT 'relevance'::text,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_coach_specializations text[] DEFAULT NULL::text[],
  p_target_category text DEFAULT NULL::text,
  -- Phase 2 (2e) — candidate intent filters (all NULL-neutral).
  p_relocation_willingness text DEFAULT NULL::text,
  p_relocation_to_country_ids integer[] DEFAULT NULL::integer[],
  p_level_target text DEFAULT NULL::text,
  p_opportunity_preference text DEFAULT NULL::text,
  p_available_by date DEFAULT NULL::date,
  p_specialist_skills text[] DEFAULT NULL::text[]
)
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

-- Re-grant (DROP above removed the prior grants).
GRANT EXECUTE ON FUNCTION public.discover_profiles TO authenticated;
GRANT EXECUTE ON FUNCTION public.discover_profiles TO service_role;
