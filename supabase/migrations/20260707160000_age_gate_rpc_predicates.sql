-- ============================================================================
-- P3 — 18+ age gate: layer 3 of 3 — per-RPC predicate filters
-- ============================================================================
-- Layers (see 20260707151000_age_gate_core.sql):
--   (1) base RLS SELECT policies on profiles           — shipped in core
--   (2) BEFORE-INSERT triggers on direct contact paths — shipped in core
--   (3) THIS migration — the read RPCs below are SECURITY DEFINER (they run
--       as the function owner and BYPASS profiles RLS entirely), so each one
--       must apply the shared predicates itself.
--       (get_top_community_members is SECURITY INVOKER, but is included
--       because the DOB-grace restriction is not covered by RLS at all.)
--
-- Surface classes:
--   DISCOVERY/CONTACT → AND NOT public.profile_is_uncontactable(...)
--     discover_profiles, community_search_members, get_top_community_members,
--     search_people_for_signing — hidden (banned/frozen) accounts AND
--     grace-lapsed unknown-age person accounts vanish.
--   PASSIVE READ      → AND NOT public.profile_is_hidden(...)
--     search_content, get_club_members, get_brand_followers,
--     get_brand_ambassadors_public, get_my_profile_viewers, get_home_feed —
--     only banned/frozen accounts vanish; grace-restricted accounts remain
--     passively referenced.
--
-- Deploy-dark safe: no row has frozen_minor_at or dob_required_since set
-- until the backfill migration arms them, so profile_is_uncontactable
-- reduces to profile_is_hidden, and profile_is_hidden reduces to the
-- existing is_blocked semantics — behaviour only changes where is_blocked
-- coverage was already missing (see next paragraph), which is a repair.
--
-- Bundled repair (audit theme "inconsistent block enforcement"): several of
-- these RPCs never filtered is_blocked at all — search_content (people,
-- posts and opportunities branches), get_club_members,
-- search_people_for_signing, get_my_profile_viewers, get_brand_followers,
-- get_brand_ambassadors_public, and get_home_feed authors. The predicates
-- close that gap here as well (profile_is_hidden covers is_blocked).
--
-- Bodies below are byte-identical to the live STAGING definitions
-- (pg_get_functiondef, fetched 2026-07-07) except for the marked
-- `-- age-gate:` lines. CREATE OR REPLACE preserves existing ACLs.

-- ────────────────────────────────────────────────────────────────────
-- 1. discover_profiles — DISCOVERY (recruiter match / discovery grid)
--    profiles alias: p (COUNT block + results block; both patched)
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.discover_profiles(p_roles text[] DEFAULT NULL::text[], p_positions text[] DEFAULT NULL::text[], p_gender text DEFAULT NULL::text, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_nationality_country_ids integer[] DEFAULT NULL::integer[], p_eu_passport boolean DEFAULT NULL::boolean, p_base_country_ids integer[] DEFAULT NULL::integer[], p_base_location text DEFAULT NULL::text, p_availability text DEFAULT NULL::text, p_min_references integer DEFAULT NULL::integer, p_min_career_entries integer DEFAULT NULL::integer, p_league_ids integer[] DEFAULT NULL::integer[], p_country_ids integer[] DEFAULT NULL::integer[], p_search_text text DEFAULT NULL::text, p_sort_by text DEFAULT 'relevance'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_coach_specializations text[] DEFAULT NULL::text[], p_target_category text DEFAULT NULL::text, p_relocation_willingness text DEFAULT NULL::text, p_relocation_to_country_ids integer[] DEFAULT NULL::integer[], p_level_target text DEFAULT NULL::text, p_opportunity_preference text DEFAULT NULL::text, p_available_by date DEFAULT NULL::date, p_specialist_skills text[] DEFAULT NULL::text[], p_required_positions text[] DEFAULT NULL::text[], p_exclude_paid_seekers boolean DEFAULT NULL::boolean, p_required_location_country_id integer DEFAULT NULL::integer)
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

-- ────────────────────────────────────────────────────────────────────
-- 2. community_search_members — DISCOVERY (community directory + filters)
--    profiles alias: p (COUNT block + results block; both patched)
-- ────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────
-- 3. get_top_community_members — DISCOVERY (community landing carousel)
--    profiles alias: p. NOTE: SECURITY INVOKER — RLS already hides
--    banned/frozen rows, but the DOB-grace restriction needs this filter.
-- ────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────
-- 4. search_people_for_signing — DISCOVERY/CONTACT (club "sign a member")
--    profiles alias: p. Had NO is_blocked filter before (bundled repair).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_people_for_signing(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, full_name text, avatar_url text, role text, "position" text, current_club text, base_location text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_user_id UUID := auth.uid(); v_normalized TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN; END IF;
  v_normalized := lower(trim(p_query));
  IF char_length(v_normalized) < 2 THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.full_name, p.avatar_url, p.role, p.position, p.current_club, p.base_location
  FROM profiles p
  WHERE p.role IN ('player', 'coach') AND p.onboarding_completed = true AND p.id != v_user_id
    AND lower(p.full_name) LIKE '%' || v_normalized || '%'
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id))
    -- age-gate: layer-3 contact fence (also this RPC's first is_blocked filter)
    AND NOT public.profile_is_uncontactable(p.is_blocked, p.frozen_minor_at, p.role, p.date_of_birth, p.dob_required_since)
  ORDER BY CASE WHEN lower(p.full_name) LIKE v_normalized || '%' THEN 0 ELSE 1 END, p.full_name ASC
  LIMIT LEAST(p_limit, 20);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 5. search_content — PASSIVE READ (global search)
--    Patched branches: posts (author alias p), people (alias p),
--    opportunities (publisher alias cp — an opportunity is authored content,
--    so a hidden/banned publisher's listings vanish too; this is also the
--    is_blocked repair for that branch).
--    Left untouched: clubs branch (world_clubs directory rows — the LEFT
--    JOIN to profiles only decorates the avatar of a claimed club; the row
--    is directory data, not a profile surface) and brands branch (brands
--    table rows; profiles LEFT JOIN only supplies the verified badge).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_content(p_query text, p_type text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_test BOOLEAN;
  v_tsquery tsquery;
  v_results JSONB := '[]'::jsonb;
  v_post_results JSONB; v_people_results JSONB; v_club_results JSONB; v_brand_results JSONB; v_opportunity_results JSONB;
  v_post_count BIGINT := 0; v_people_count BIGINT := 0; v_club_count BIGINT := 0; v_brand_count BIGINT := 0; v_opportunity_count BIGINT := 0;
  v_normalized TEXT; v_sanitized TEXT;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Not authenticated'); END IF;
  v_normalized := trim(p_query);
  IF char_length(v_normalized) < 2 THEN
    RETURN jsonb_build_object('results','[]'::jsonb,'total',0,'type_counts',jsonb_build_object('posts',0,'people',0,'clubs',0,'brands',0,'opportunities',0));
  END IF;
  SELECT is_staging_env() OR COALESCE(is_test_account, false) INTO v_is_test FROM profiles WHERE id = v_user_id;
  v_sanitized := regexp_replace(regexp_replace(v_normalized, '[^a-zA-Z0-9\s]', ' ', 'g'), '\s+', ' ', 'g');
  v_sanitized := trim(v_sanitized);
  IF char_length(v_sanitized) < 1 THEN
    RETURN jsonb_build_object('results','[]'::jsonb,'total',0,'type_counts',jsonb_build_object('posts',0,'people',0,'clubs',0,'brands',0,'opportunities',0));
  END IF;
  BEGIN v_tsquery := to_tsquery('english', regexp_replace(v_sanitized, '\s+', ':* & ', 'g') || ':*'); EXCEPTION WHEN OTHERS THEN v_tsquery := plainto_tsquery('english', v_normalized); END;

  IF p_type IS NULL OR p_type = 'posts' THEN
    SELECT COUNT(*) INTO v_post_count FROM user_posts up JOIN profiles p ON p.id = up.author_id
    WHERE up.deleted_at IS NULL AND up.search_vector @@ v_tsquery
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      -- age-gate: posts by hidden (banned/frozen) authors vanish
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id));
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_post_results FROM (
      SELECT jsonb_build_object('result_type','post','post_id',up.id,'content',up.content,'images',up.images,'author_id',up.author_id,'author_name',COALESCE(b.name,p.full_name),'author_avatar',COALESCE(b.logo_url,p.avatar_url),'author_role',p.role,'like_count',up.like_count,'comment_count',up.comment_count,'post_type',COALESCE(up.post_type,'text'),'created_at',up.created_at) AS row_data, ts_rank(up.search_vector, v_tsquery) AS rank
      FROM user_posts up JOIN profiles p ON p.id = up.author_id LEFT JOIN brands b ON b.profile_id = p.id
      WHERE up.deleted_at IS NULL AND up.search_vector @@ v_tsquery
        AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
        -- age-gate: posts by hidden (banned/frozen) authors vanish
        AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
        AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = up.author_id) OR (ub.blocker_id = up.author_id AND ub.blocked_id = v_user_id))
      ORDER BY rank DESC, up.created_at DESC
      LIMIT CASE WHEN p_type = 'posts' THEN p_limit ELSE 5 END OFFSET CASE WHEN p_type = 'posts' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type IS NULL OR p_type = 'people' THEN
    SELECT COUNT(*) INTO v_people_count FROM profiles p
    WHERE p.onboarding_completed = true AND (p.search_vector @@ v_tsquery OR p.full_name ILIKE '%' || v_normalized || '%')
      AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
      -- age-gate: hidden profiles vanish (also this branch's first is_blocked filter)
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id));
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_people_results FROM (
      SELECT jsonb_build_object('result_type','person','profile_id',p.id,'full_name',COALESCE(b.name,p.full_name),'avatar_url',COALESCE(b.logo_url,p.avatar_url),'role',p.role,'bio',COALESCE(p.bio,p.club_bio),'position',p.position,'base_location',p.base_location,'current_club',p.current_club) AS row_data, ts_rank(p.search_vector, v_tsquery) AS rank
      FROM profiles p LEFT JOIN brands b ON b.profile_id = p.id
      WHERE p.onboarding_completed = true AND (p.search_vector @@ v_tsquery OR p.full_name ILIKE '%' || v_normalized || '%')
        AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
        -- age-gate: hidden profiles vanish (also this branch's first is_blocked filter)
        AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
        AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = p.id) OR (ub.blocker_id = p.id AND ub.blocked_id = v_user_id))
      ORDER BY rank DESC, p.full_name
      LIMIT CASE WHEN p_type = 'people' THEN p_limit ELSE 5 END OFFSET CASE WHEN p_type = 'people' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type IS NULL OR p_type = 'clubs' THEN
    SELECT COUNT(*) INTO v_club_count FROM world_clubs wc WHERE wc.club_name_normalized LIKE '%' || lower(v_normalized) || '%';
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank, club_name), '[]'::jsonb) INTO v_club_results FROM (
      SELECT jsonb_build_object('result_type','club','world_club_id',wc.id,'club_name',wc.club_name,'country_id',wc.country_id,'country_code',c.code,'country_name',c.name,'flag_emoji',c.flag_emoji,'avatar_url',p.avatar_url,'is_claimed',wc.is_claimed,'claimed_profile_id',wc.claimed_profile_id) AS row_data,
      CASE WHEN wc.club_name_normalized LIKE lower(v_normalized) || '%' THEN 0 ELSE 1 END AS rank, wc.club_name
      FROM world_clubs wc JOIN countries c ON c.id = wc.country_id LEFT JOIN profiles p ON p.id = wc.claimed_profile_id
      WHERE wc.club_name_normalized LIKE '%' || lower(v_normalized) || '%'
      ORDER BY rank, wc.club_name
      LIMIT CASE WHEN p_type = 'clubs' THEN p_limit ELSE 5 END OFFSET CASE WHEN p_type = 'clubs' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type IS NULL OR p_type = 'brands' THEN
    SELECT COUNT(*) INTO v_brand_count FROM brands b WHERE b.deleted_at IS NULL AND (b.search_vector @@ v_tsquery OR lower(b.name) LIKE '%' || lower(v_normalized) || '%');
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank, brand_name), '[]'::jsonb) INTO v_brand_results FROM (
      SELECT jsonb_build_object('result_type','brand','brand_id',b.id,'brand_slug',b.slug,'brand_name',b.name,'brand_logo_url',b.logo_url,'brand_category',b.category,'brand_is_verified',COALESCE(p.is_verified,false),'brand_bio',b.bio) AS row_data,
      CASE WHEN lower(b.name) LIKE lower(v_normalized) || '%' THEN 0 ELSE 1 END AS rank, b.name AS brand_name
      FROM brands b LEFT JOIN profiles p ON p.id = b.profile_id
      WHERE b.deleted_at IS NULL AND (b.search_vector @@ v_tsquery OR lower(b.name) LIKE '%' || lower(v_normalized) || '%')
      ORDER BY rank, b.name
      LIMIT CASE WHEN p_type = 'brands' THEN p_limit ELSE 5 END OFFSET CASE WHEN p_type = 'brands' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type IS NULL OR p_type = 'opportunities' THEN
    SELECT COUNT(*) INTO v_opportunity_count FROM opportunities o JOIN profiles cp ON cp.id = o.club_id
    WHERE o.status = 'open' AND o.search_vector @@ v_tsquery AND (v_is_test OR cp.is_test_account IS NULL OR cp.is_test_account = false)
      -- age-gate: listings by hidden (banned) publishers vanish
      AND NOT public.profile_is_hidden(cp.is_blocked, cp.frozen_minor_at);
    SELECT COALESCE(jsonb_agg(row_data ORDER BY rank DESC), '[]'::jsonb) INTO v_opportunity_results FROM (
      SELECT jsonb_build_object('result_type','opportunity','opportunity_id',o.id,'title',o.title,'opportunity_type',o.opportunity_type,'position',o.position,'location_city',o.location_city,'location_country',o.location_country,'club_name',COALESCE(cp.full_name,o.organization_name,'Unknown Club'),'club_avatar_url',cp.avatar_url,'published_at',o.published_at) AS row_data, ts_rank(o.search_vector, v_tsquery) AS rank
      FROM opportunities o JOIN profiles cp ON cp.id = o.club_id
      WHERE o.status = 'open' AND o.search_vector @@ v_tsquery AND (v_is_test OR cp.is_test_account IS NULL OR cp.is_test_account = false)
        -- age-gate: listings by hidden (banned) publishers vanish
        AND NOT public.profile_is_hidden(cp.is_blocked, cp.frozen_minor_at)
      ORDER BY rank DESC, o.published_at DESC NULLS LAST
      LIMIT CASE WHEN p_type = 'opportunities' THEN p_limit ELSE 5 END OFFSET CASE WHEN p_type = 'opportunities' THEN p_offset ELSE 0 END
    ) sub;
  END IF;

  IF p_type = 'posts' THEN v_results := COALESCE(v_post_results, '[]'::jsonb);
  ELSIF p_type = 'people' THEN v_results := COALESCE(v_people_results, '[]'::jsonb);
  ELSIF p_type = 'clubs' THEN v_results := COALESCE(v_club_results, '[]'::jsonb);
  ELSIF p_type = 'brands' THEN v_results := COALESCE(v_brand_results, '[]'::jsonb);
  ELSIF p_type = 'opportunities' THEN v_results := COALESCE(v_opportunity_results, '[]'::jsonb);
  ELSE v_results := COALESCE(v_post_results, '[]'::jsonb) || COALESCE(v_people_results, '[]'::jsonb) || COALESCE(v_club_results, '[]'::jsonb) || COALESCE(v_brand_results, '[]'::jsonb) || COALESCE(v_opportunity_results, '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object('results', v_results, 'total', v_post_count + v_people_count + v_club_count + v_brand_count + v_opportunity_count, 'type_counts', jsonb_build_object('posts',v_post_count,'people',v_people_count,'clubs',v_club_count,'brands',v_brand_count,'opportunities',v_opportunity_count));
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 6. get_club_members — PASSIVE READ (club roster page)
--    profiles alias: p inside the `members` CTE (single fence covers the
--    total count and the page — the outer re-join only decorates rows the
--    CTE already admitted). Had NO is_blocked filter before (bundled repair).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_club_members(p_profile_id uuid, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, full_name text, avatar_url text, role text, nationality text, nationality_country_id integer, nationality2_country_id integer, base_location text, "position" text, secondary_position text, current_club text, current_world_club_id uuid, created_at timestamp with time zone, open_to_play boolean, open_to_coach boolean, is_test_account boolean, is_roster_member boolean, club_member_id uuid, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH club_ids AS (
    SELECT wc.id AS world_club_id FROM world_clubs wc WHERE wc.claimed_profile_id = p_profile_id
  ),
  roster AS (
    SELECT cm.member_profile_id AS pid, cm.id AS club_member_id
    FROM club_members cm WHERE cm.club_profile_id = p_profile_id AND cm.status = 'active'
  ),
  members AS (
    SELECT p.id AS pid, (r.pid IS NOT NULL) AS is_roster, r.club_member_id
    FROM profiles p
    LEFT JOIN roster r ON r.pid = p.id
    WHERE p.role IN ('player', 'coach')
      AND p.onboarding_completed = true
      -- age-gate: hidden members vanish (also this RPC's first is_blocked filter)
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
      AND (
        p.current_world_club_id IN (SELECT world_club_id FROM club_ids)
        OR r.pid IS NOT NULL
      )
  ),
  counted AS (SELECT COUNT(*) AS cnt FROM members)
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    p.role::text,
    p.nationality,
    p.nationality_country_id,
    p.nationality2_country_id,
    p.base_location,
    p.position,
    p.secondary_position,
    p.current_club,
    p.current_world_club_id,
    p.created_at,
    p.open_to_play,
    p.open_to_coach,
    p.is_test_account,
    m.is_roster,
    m.club_member_id,
    c.cnt
  FROM members m
  JOIN profiles p ON p.id = m.pid
  CROSS JOIN counted c
  ORDER BY p.full_name ASC
  LIMIT p_limit
  OFFSET p_offset;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 7. get_brand_followers — PASSIVE READ (brand followers list)
--    profiles alias: p in the page query; the COUNT never joins profiles,
--    so it gets the same fence in EXISTS form (alias hp) to keep `total`
--    consistent with the visible list — exactly how the existing block
--    filter is applied there. Had NO is_blocked filter before.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_brand_followers(p_brand_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_total BIGINT; v_followers JSONB; v_user_id UUID := auth.uid();
BEGIN
  SELECT COUNT(*) INTO v_total FROM brand_followers bf WHERE bf.brand_id = p_brand_id
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = bf.follower_id) OR (ub.blocker_id = bf.follower_id AND ub.blocked_id = v_user_id))
    -- age-gate: hidden followers vanish (EXISTS form; COUNT has no profiles join)
    AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = bf.follower_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at));

  SELECT COALESCE(jsonb_agg(row_data ORDER BY followed_at DESC), '[]'::jsonb) INTO v_followers
  FROM (
    SELECT jsonb_build_object('profile_id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'role', p.role, 'followed_at', bf.created_at) AS row_data, bf.created_at AS followed_at
    FROM brand_followers bf JOIN profiles p ON p.id = bf.follower_id
    WHERE bf.brand_id = p_brand_id
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = bf.follower_id) OR (ub.blocker_id = bf.follower_id AND ub.blocked_id = v_user_id))
      -- age-gate: hidden followers vanish
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    ORDER BY bf.created_at DESC LIMIT LEAST(p_limit, 50) OFFSET p_offset
  ) sub;
  RETURN jsonb_build_object('followers', v_followers, 'total', v_total);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 8. get_brand_ambassadors_public — PASSIVE READ (brand ambassadors strip)
--    profiles alias: p in the page query; COUNT (no profiles join, no table
--    alias — bare player_id) gets the EXISTS form, mirroring get_brand_followers.
--    Had NO is_blocked filter before.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_brand_ambassadors_public(p_brand_id uuid, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_total BIGINT; v_ambassadors JSONB; v_user_id UUID := auth.uid();
BEGIN
  SELECT COUNT(*) INTO v_total FROM brand_ambassadors WHERE brand_id = p_brand_id AND status = 'accepted'
    AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = player_id) OR (ub.blocker_id = player_id AND ub.blocked_id = v_user_id))
    -- age-gate: hidden ambassadors vanish (EXISTS form; COUNT has no profiles join)
    AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = player_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at));

  SELECT COALESCE(jsonb_agg(row_data ORDER BY added_at DESC), '[]'::jsonb) INTO v_ambassadors
  FROM (
    SELECT jsonb_build_object('player_id', p.id, 'full_name', p.full_name, 'avatar_url', p.avatar_url, 'position', p.position, 'current_club', p.current_club) AS row_data, ba.created_at AS added_at
    FROM brand_ambassadors ba JOIN profiles p ON p.id = ba.player_id
    WHERE ba.brand_id = p_brand_id AND ba.status = 'accepted'
      AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = ba.player_id) OR (ub.blocker_id = ba.player_id AND ub.blocked_id = v_user_id))
      -- age-gate: hidden ambassadors vanish
      AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    ORDER BY ba.created_at DESC LIMIT LEAST(p_limit, 12)
  ) sub;
  RETURN jsonb_build_object('ambassadors', v_ambassadors, 'total', v_total);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 9. get_my_profile_viewers — PASSIVE READ ("who viewed my profile")
--    profiles alias: p. Had NO is_blocked filter before (bundled repair).
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_profile_viewers(p_days integer DEFAULT 30, p_limit integer DEFAULT 20)
 RETURNS TABLE(viewer_id uuid, full_name text, role text, username text, avatar_url text, base_location text, brand_slug text, viewed_at timestamp with time zone, view_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_since TIMESTAMPTZ;
  v_clamped_limit INT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  v_since := now() - (p_days || ' days')::INTERVAL;
  v_clamped_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);

  RETURN QUERY
  WITH viewer_events AS (
    SELECT
      e.user_id AS vid,
      MAX(e.created_at) AS last_viewed_at,
      COUNT(*) AS cnt
    FROM events e
    WHERE e.event_name = 'profile_view'
      AND e.entity_type = 'profile'
      AND e.entity_id = v_user_id
      AND e.created_at >= v_since
      AND e.user_id IS NOT NULL
      AND e.user_id != v_user_id
    GROUP BY e.user_id
  )
  SELECT
    ve.vid AS viewer_id,
    p.full_name,
    p.role,
    p.username,
    p.avatar_url,
    p.base_location,
    b.slug AS brand_slug,
    ve.last_viewed_at AS viewed_at,
    ve.cnt AS view_count
  FROM viewer_events ve
  INNER JOIN profiles p ON p.id = ve.vid
  LEFT JOIN brands b ON b.profile_id = ve.vid AND b.deleted_at IS NULL
  WHERE p.browse_anonymously = false
    AND COALESCE(p.is_test_account, false) = false
    AND (p.role <> 'brand' OR b.id IS NOT NULL)
    -- age-gate: hidden viewers vanish (also this RPC's first is_blocked filter)
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks ub
      WHERE (ub.blocker_id = v_user_id AND ub.blocked_id = ve.vid)
         OR (ub.blocker_id = ve.vid AND ub.blocked_id = v_user_id)
    )
  ORDER BY ve.last_viewed_at DESC
  LIMIT v_clamped_limit;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 10. get_home_feed — PASSIVE READ (home feed)
--     home_feed_items branches: EXISTS fence on hfi/hfi2.author_profile_id
--     (nullable — system items with NULL author pass through untouched;
--     NOT EXISTS is vacuously true for them). user_posts branches: direct
--     fence on the joined author profile (aliases p / p2). freeze_minor_account
--     already deletes a frozen minor's feed items, so this mainly covers
--     admin-banned authors — the is_blocked repair for the feed.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_home_feed(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_item_type text DEFAULT NULL::text, p_country_ids integer[] DEFAULT NULL::integer[], p_roles text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB;
  v_total BIGINT;
  v_user_id UUID := auth.uid();
  v_is_test BOOLEAN;
  v_blocked_ids UUID[];
BEGIN
  SELECT is_staging_env() OR COALESCE(is_test_account, false) INTO v_is_test
  FROM profiles WHERE id = v_user_id;

  -- Bidirectional: caller blocked them OR they blocked caller. Matches
  -- the semantics of public.is_blocked_pair used by enqueue_notification.
  SELECT COALESCE(array_agg(other_id), ARRAY[]::UUID[])
    INTO v_blocked_ids
    FROM (
      SELECT blocked_id AS other_id FROM user_blocks WHERE blocker_id = v_user_id
      UNION
      SELECT blocker_id AS other_id FROM user_blocks WHERE blocked_id = v_user_id
    ) blocks;

  IF p_item_type IS NULL OR p_item_type = '' THEN

    SELECT (
      (SELECT COUNT(*)
       FROM home_feed_items hfi
       WHERE hfi.deleted_at IS NULL
         AND hfi.item_type != 'member_joined'
         AND (v_is_test OR hfi.is_test_account = false)
         AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
         -- age-gate: items by hidden authors vanish (NULL authors pass)
         AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
         AND (
           p_roles IS NULL
           OR hfi.author_role = ANY(p_roles)
         )
         AND (
           p_country_ids IS NULL
           OR hfi.item_type IN ('brand_post', 'brand_product')
           OR hfi.author_role = 'brand'
           OR hfi.author_country_id = ANY(p_country_ids)
         )
      )
      +
      (SELECT COUNT(*)
       FROM user_posts up
       JOIN profiles p ON p.id = up.author_id
       WHERE up.deleted_at IS NULL
         AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
         AND NOT (up.author_id = ANY(v_blocked_ids))
         -- age-gate: posts by hidden authors vanish
         AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
         AND (
           p_roles IS NULL
           OR p.role = ANY(p_roles)
         )
         AND (
           p_country_ids IS NULL
           OR p.role = 'brand'
           OR p.nationality_country_id = ANY(p_country_ids)
         )
      )
    ) INTO v_total;

    SELECT COALESCE(jsonb_agg(c.item_data ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT item_data, created_at FROM (
        SELECT
          hfi.created_at,
          hfi.metadata || jsonb_build_object(
            'feed_item_id', hfi.id,
            'item_type', hfi.item_type,
            'created_at', hfi.created_at
          ) AS item_data
        FROM home_feed_items hfi
        WHERE hfi.deleted_at IS NULL
          AND hfi.item_type != 'member_joined'
          AND (v_is_test OR hfi.is_test_account = false)
          AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
          -- age-gate: items by hidden authors vanish (NULL authors pass)
          AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
          AND (
            p_roles IS NULL
            OR hfi.author_role = ANY(p_roles)
          )
          AND (
            p_country_ids IS NULL
            OR hfi.item_type IN ('brand_post', 'brand_product')
            OR hfi.author_role = 'brand'
            OR hfi.author_country_id = ANY(p_country_ids)
          )

        UNION ALL

        SELECT
          up.created_at,
          jsonb_build_object(
            'feed_item_id', up.id,
            'item_type', 'user_post',
            'created_at', up.created_at,
            'post_id', up.id,
            'author_id', up.author_id,
            'author_name', COALESCE(b.name, p.full_name),
            'author_avatar', COALESCE(b.logo_url, p.avatar_url),
            'author_role', p.role,
            'content', up.content,
            'images', up.images,
            'like_count', up.like_count,
            'comment_count', up.comment_count,
            'has_liked', EXISTS (
              SELECT 1 FROM post_likes pl
              WHERE pl.post_id = up.id AND pl.user_id = v_user_id
            )
          ) AS item_data
        FROM user_posts up
        JOIN profiles p ON p.id = up.author_id
        LEFT JOIN brands b ON b.profile_id = p.id
        WHERE up.deleted_at IS NULL
          AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
          AND NOT (up.author_id = ANY(v_blocked_ids))
          -- age-gate: posts by hidden authors vanish
          AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
          AND (
            p_roles IS NULL
            OR p.role = ANY(p_roles)
          )
          AND (
            p_country_ids IS NULL
            OR p.role = 'brand'
            OR p.nationality_country_id = ANY(p_country_ids)
          )
      ) unified
      ORDER BY created_at DESC
      LIMIT p_limit OFFSET p_offset
    ) c;

    RETURN jsonb_build_object('items', v_items, 'total', v_total);
  END IF;

  IF p_item_type != 'user_post' THEN
    SELECT COUNT(*) INTO v_total
    FROM home_feed_items hfi
    WHERE hfi.deleted_at IS NULL
      AND hfi.item_type = p_item_type
      AND hfi.item_type != 'member_joined'
      AND (v_is_test OR hfi.is_test_account = false)
      AND (hfi.author_profile_id IS NULL OR NOT (hfi.author_profile_id = ANY(v_blocked_ids)))
      -- age-gate: items by hidden authors vanish (NULL authors pass)
      AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
      AND (p_roles IS NULL OR hfi.author_role = ANY(p_roles))
      AND (
        p_country_ids IS NULL
        OR hfi.item_type IN ('brand_post', 'brand_product')
        OR hfi.author_role = 'brand'
        OR hfi.author_country_id = ANY(p_country_ids)
      );

    SELECT COALESCE(jsonb_agg(
      hfi.metadata || jsonb_build_object(
        'feed_item_id', hfi.id,
        'item_type', hfi.item_type,
        'created_at', hfi.created_at
      )
      ORDER BY hfi.created_at DESC
    ), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT id, item_type, metadata, created_at
      FROM home_feed_items hfi2
      WHERE hfi2.deleted_at IS NULL
        AND hfi2.item_type = p_item_type
        AND hfi2.item_type != 'member_joined'
        AND (v_is_test OR hfi2.is_test_account = false)
        AND (hfi2.author_profile_id IS NULL OR NOT (hfi2.author_profile_id = ANY(v_blocked_ids)))
        -- age-gate: items by hidden authors vanish (NULL authors pass)
        AND NOT EXISTS (SELECT 1 FROM public.profiles hp WHERE hp.id = hfi2.author_profile_id AND public.profile_is_hidden(hp.is_blocked, hp.frozen_minor_at))
        AND (p_roles IS NULL OR hfi2.author_role = ANY(p_roles))
        AND (
          p_country_ids IS NULL
          OR hfi2.item_type IN ('brand_post', 'brand_product')
          OR hfi2.author_role = 'brand'
          OR hfi2.author_country_id = ANY(p_country_ids)
        )
      ORDER BY created_at DESC
      LIMIT p_limit OFFSET p_offset
    ) hfi;

    RETURN jsonb_build_object('items', v_items, 'total', v_total);
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM user_posts up
  JOIN profiles p ON p.id = up.author_id
  WHERE up.deleted_at IS NULL
    AND (v_is_test OR p.is_test_account IS NULL OR p.is_test_account = false)
    AND NOT (up.author_id = ANY(v_blocked_ids))
    -- age-gate: posts by hidden authors vanish
    AND NOT public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    AND (p_roles IS NULL OR p.role = ANY(p_roles))
    AND (
      p_country_ids IS NULL
      OR p.role = 'brand'
      OR p.nationality_country_id = ANY(p_country_ids)
    );

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'feed_item_id', up.id,
      'item_type', 'user_post',
      'created_at', up.created_at,
      'post_id', up.id,
      'author_id', up.author_id,
      'author_name', COALESCE(b.name, p.full_name),
      'author_avatar', COALESCE(b.logo_url, p.avatar_url),
      'author_role', p.role,
      'content', up.content,
      'images', up.images,
      'like_count', up.like_count,
      'comment_count', up.comment_count,
      'has_liked', EXISTS (
        SELECT 1 FROM post_likes pl
        WHERE pl.post_id = up.id AND pl.user_id = v_user_id
      )
    )
    ORDER BY up.created_at DESC
  ), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT up2.id, up2.author_id, up2.content, up2.images,
           up2.like_count, up2.comment_count, up2.created_at
    FROM user_posts up2
    JOIN profiles p2 ON p2.id = up2.author_id
    WHERE up2.deleted_at IS NULL
      AND (v_is_test OR p2.is_test_account IS NULL OR p2.is_test_account = false)
      AND NOT (up2.author_id = ANY(v_blocked_ids))
      -- age-gate: posts by hidden authors vanish
      AND NOT public.profile_is_hidden(p2.is_blocked, p2.frozen_minor_at)
      AND (p_roles IS NULL OR p2.role = ANY(p_roles))
      AND (
        p_country_ids IS NULL
        OR p2.role = 'brand'
        OR p2.nationality_country_id = ANY(p_country_ids)
      )
    ORDER BY up2.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) up
  JOIN profiles p ON p.id = up.author_id
  LEFT JOIN brands b ON b.profile_id = p.id;

  RETURN jsonb_build_object('items', v_items, 'total', v_total);
END;
$function$;
