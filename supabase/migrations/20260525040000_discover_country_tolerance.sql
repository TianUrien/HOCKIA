-- Data-quality Tier 1 — make country filtering tolerant of two real gaps:
--
-- 1. GB ↔ GB-ENG equivalence
--    The directory uses GB-ENG for England. Most British users self-identify
--    as "United Kingdom" (GB) in the country picker — at audit time, 14
--    members claimed GB by nationality vs only 5 claiming GB-ENG. Searching
--    by England (the curated directory entry) missed the 14, and searching
--    by United Kingdom missed the 5. This treats the two as bidirectionally
--    equivalent for filter purposes — centralized in a helper so Scotland
--    (GB-SCT) / Wales (GB-WLS) / Northern Ireland (GB-NIR) can be added
--    later in one place when directories for those nations exist.
--
-- 2. base_country fallback to nationality
--    77% of players on prod have nationality set but no base_country (they
--    skipped the field at onboarding). The "find players in X" filter
--    silently excluded them. This makes the filter fall back to
--    nationality_country (either field) when base_country IS NULL —
--    interpreting "I'm a Kenyan player" as "I'm probably in Kenya" when
--    we have no better data. Reversible: setting base_country always
--    wins because the OR-clause checks base first.

set check_function_bodies = off;
set search_path = public;

-- ── Country equivalence helper ──────────────────────────────────────────
-- STABLE: same input → same output within a transaction. Marked STABLE
-- rather than IMMUTABLE because the countries table COULD change (new
-- rows added), though in practice this is rare. STABLE is safe for use
-- in WHERE clauses and lets the planner cache the result per call.
CREATE OR REPLACE FUNCTION public.expand_country_equivalents(
  p_ids INTEGER[]
)
RETURNS INTEGER[]
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_result INTEGER[] := p_ids;
  v_gb_id INTEGER;
  v_gb_eng_id INTEGER;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN p_ids;
  END IF;

  SELECT id INTO v_gb_id FROM public.countries WHERE code = 'GB';
  SELECT id INTO v_gb_eng_id FROM public.countries WHERE code = 'GB-ENG';

  -- If GB is in the input, also include GB-ENG (and vice versa). Use
  -- array_append guarded by NOT IN to avoid dupes.
  IF v_gb_id IS NOT NULL AND v_gb_id = ANY(p_ids)
     AND v_gb_eng_id IS NOT NULL AND NOT (v_gb_eng_id = ANY(v_result)) THEN
    v_result := array_append(v_result, v_gb_eng_id);
  END IF;
  IF v_gb_eng_id IS NOT NULL AND v_gb_eng_id = ANY(p_ids)
     AND v_gb_id IS NOT NULL AND NOT (v_gb_id = ANY(v_result)) THEN
    v_result := array_append(v_result, v_gb_id);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expand_country_equivalents(INTEGER[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.expand_country_equivalents IS
  'Returns the input country-ID array expanded with any known equivalents (currently GB ↔ GB-ENG). Used inside discover_profiles so search filters tolerate the natural-language vs ISO-2 split in user-entered country data.';

-- ── discover_profiles — country-tolerant rewrite ────────────────────────
-- Signature unchanged so all callers stay working. Body changes:
--   1. Compute v_nat / v_base / v_country expansions ONCE at the top via
--      expand_country_equivalents().
--   2. Replace WHERE checks against p_*_country_ids with v_*.
--   3. base_country filter falls back to nationality when base is null.
-- Everything else (sort, projection, has_more, results envelope, the
-- staging-test-account gate, etc.) is byte-for-byte the previous body.
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
  p_target_category text DEFAULT NULL::text
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
  -- Country-tolerance: expanded versions of the country-id filter inputs.
  -- GB ↔ GB-ENG bidirectional via expand_country_equivalents().
  v_nationality_country_ids INT[] := expand_country_equivalents(p_nationality_country_ids);
  v_base_country_ids INT[] := expand_country_equivalents(p_base_country_ids);
  v_country_ids INT[] := expand_country_equivalents(p_country_ids);
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
    -- base_country filter: match base_country if set, else fall back to
    -- nationality_country. Covers the ~77% of players with nationality
    -- set but no base — "find players in Kenya" should surface Kenyan
    -- players even if they skipped the base-location step.
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
      'coach_specialization_custom', p.coach_specialization_custom
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
      -- Phase 1a: within a match set, richer / more-complete profiles first.
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
