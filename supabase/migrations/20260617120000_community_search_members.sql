-- ============================================================================
-- Phase 4 — community_search_members RPC (the Community grid ceiling-lift)
-- ============================================================================
-- The Community members grid historically fetched the newest 200 profiles and
-- hard-filtered them CLIENT-SIDE, so any drawer filter could only ever see the
-- newest 200 rows — a member matching your filter but sitting at row 250 was
-- invisible. This RPC moves ALL hard filtering server-side and returns the WHOLE
-- filtered pool (capped, fit-NEUTRAL order = created_at DESC) so the client can
-- keep its existing fit-ranking + 4-lens verdict over the full set.
--
-- Mirrors discover_profiles' proven patterns: SECURITY DEFINER with explicit
-- onboarding_completed + (is_staging_env() OR not test) + is_blocked gates (the
-- DEFINER bypasses RLS, so these are the actual fence); dual-FK nationality;
-- expand_country_equivalents for GB/England tolerance; search_vector full-text.
--
-- TWO deliberate differences from discover_profiles, to match the Community
-- client's filteredMembers exactly:
--   * CATEGORY is MULTI-select (array overlap), not a single effective category.
--   * EU is KEEP-UNKNOWN (a member with no nationality on file is KEPT — an
--     incomplete profile is never a reason to hide someone; mirrors
--     isEuEligible / opportunityEligibility). discover's EU filter does not.
--
-- Additive + unused until Phase 5 wires the client to it — safe to ship alone.

set check_function_bodies = off;
set search_path = public;

-- EU-27 country ids, derived once from the canonical `countries.code` set.
-- Collapses the EU-27 list that was duplicated across TS/SQL/Deno (Phase 6 debt).
CREATE OR REPLACE FUNCTION public.eu_country_ids()
 RETURNS integer[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY_AGG(id)
  FROM countries
  WHERE code IN (
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR',
    'DE','GR','HU','IE','IT','LV','LT','LU','MT','NL',
    'PL','PT','RO','SK','SI','ES','SE'
  );
$function$;

GRANT EXECUTE ON FUNCTION public.eu_country_ids() TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.community_search_members(
  p_role text DEFAULT NULL::text,                       -- single role tab; NULL = all
  p_positions text[] DEFAULT NULL::text[],              -- lowercased player positions
  p_coach_specializations text[] DEFAULT NULL::text[],
  p_categories text[] DEFAULT NULL::text[],             -- multi-select hockey categories
  p_officiating_specializations text[] DEFAULT NULL::text[],
  p_nationality_country_ids integer[] DEFAULT NULL::integer[],
  p_eu_required boolean DEFAULT NULL::boolean,
  p_location_country_ids integer[] DEFAULT NULL::integer[],
  p_location_text text DEFAULT NULL::text,
  p_availability_open boolean DEFAULT NULL::boolean,
  p_brand_category text DEFAULT NULL::text,
  p_search_text text DEFAULT NULL::text,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
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
         OR (p.nationality_country_id IS NULL AND p.nationality2_country_id IS NULL)  -- keep-unknown
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
    AND (p_search_text IS NULL OR p.search_vector @@ plainto_tsquery('english', p_search_text));

  -- to_jsonb(row) instead of jsonb_build_object: 52 key+value pairs = 104 args
  -- would blow Postgres's 100-argument function ceiling. Selecting the columns
  -- into a row and converting keeps the column names as the JSON keys (exactly
  -- the client's Profile field names) with no arg limit.
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
    ORDER BY p.created_at DESC   -- fit-NEUTRAL; the client applies fit/completeness ranking
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
