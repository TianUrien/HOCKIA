-- ============================================================================
-- Deploy 3 — Club "Open opportunities" filter (additive param on the Community RPC)
-- ============================================================================
-- Adds ONE additive NULL-default param to community_search_members so the
-- Community grid can filter CLUBS by whether they have an open opportunity right
-- now (the #1 club question — "who's actually hiring"). The segmented control is
-- Any / For players / For coaches.
--
--   p_open_opportunity_type  NULL  → no filter (default; live client unaffected)
--                            'any' → club has any open opportunity
--                            'player' / 'coach' → split by opportunity_type
--
-- Server-derived via a correlated EXISTS against opportunities (indexed by
-- idx_opportunities_club_status on (club_id, status)). opportunities.club_id is
-- the OWNER's profiles.id (which may be a coach OR a club). The filter constrains
-- ONLY clubs: "p.role <> 'club' OR EXISTS(...)" lets every non-club pass through
-- (so passing the param on a non-club/all tab never empties the grid), while a
-- club must own a matching open opportunity.
--
-- Adding a param changes the signature → two overloads would break PostgREST
-- named-param dispatch (PGRST203). So DROP the 14-arg overload first, recreate
-- with 15. The new EXISTS clause is mirrored in BOTH the COUNT and SELECT WHERE
-- blocks (the function duplicates its WHERE — they MUST stay in lockstep).

set check_function_bodies = off;
set search_path = public;

DROP FUNCTION IF EXISTS public.community_search_members(
  text, text[], text[], text[], text[], integer[], boolean, integer[], text,
  boolean, text, text, integer, integer
);

CREATE OR REPLACE FUNCTION public.community_search_members(
  p_role text DEFAULT NULL::text,
  p_positions text[] DEFAULT NULL::text[],
  p_coach_specializations text[] DEFAULT NULL::text[],
  p_categories text[] DEFAULT NULL::text[],
  p_officiating_specializations text[] DEFAULT NULL::text[],
  p_nationality_country_ids integer[] DEFAULT NULL::integer[],
  p_eu_required boolean DEFAULT NULL::boolean,
  p_location_country_ids integer[] DEFAULT NULL::integer[],
  p_location_text text DEFAULT NULL::text,
  p_availability_open boolean DEFAULT NULL::boolean,
  p_brand_category text DEFAULT NULL::text,
  p_search_text text DEFAULT NULL::text,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_open_opportunity_type text DEFAULT NULL::text   -- NULL | 'any' | 'player' | 'coach' (club tab only)
)
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

GRANT EXECUTE ON FUNCTION public.community_search_members TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
