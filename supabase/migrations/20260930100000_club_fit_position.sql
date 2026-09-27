-- Fit counts POSITION (founder ruling 2026-09-27, round 5 item A).
--
-- QA: ranked for a GOALKEEPER role, a midfielder was "Strong fit" and the real
-- goalkeeper only "Possible" — compute_club_fit never looked at position.
--
-- Ruling:
--   * a PRIMARY position match is needed for "Strong" (green);
--   * a SECONDARY position match can reach "Possible" (yellow) at most;
--   * a wrong position is capped at "Possible" — and at no chip (grey) when the
--     role is a goalkeeper role (specialist position) or the club marked the
--     position as required (same rule as the client mirror, lib/clubFit.ts);
--   * no position on the profile = not a match: capped at "Possible", never grey
--     for that reason alone (honest absence).
--   * Coach roles compare the role's coach position with the coach's
--     coach_specialization the same way ('other' ↔ 'other_coach'); coaches have
--     no secondary specialisation.
--
-- Position only applies when the context is tied to an opportunity that HAS a
-- position. Otherwise the score is computed exactly as before (same weights,
-- same components), so every non-role context is unchanged.
--
-- Weights when position applies mirror lib/clubFit.ts WEIGHTS_WITH_POSITION:
-- position 25 %, the original four scaled ×0.75.
--
-- Backward compatible: same signature, same RETURNS TABLE. components gains
--   position_match               1 | 0.5 | 0   (only when position applies)
--   role_position                the role's position token
--   candidate_position           the candidate's primary position / coach specialisation
--   candidate_secondary_position the player's secondary position (players only)
-- Old readers ignore the extra keys.
--
-- Body = live staging body (pg_get_functiondef 2026-09-27) + the position block.
-- Security unchanged: SECURITY INVOKER (as live), STABLE, SET search_path, the
-- recruiters-only guard first. Grants restated explicitly (identical to live).
-- The cache is cleared so no pre-position score lingers (24 h TTL otherwise).

CREATE OR REPLACE FUNCTION public.compute_club_fit(p_owner_id uuid, p_player_id uuid, p_target text, p_region text, p_opportunity_id uuid)
 RETURNS TABLE(score numeric, state text, components jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_player          RECORD;
  v_owner           RECORD;
  v_player_band     INTEGER;
  v_viewer_band     INTEGER;
  v_gender_match    NUMERIC;
  v_proximity       NUMERIC;
  v_availability    NUMERIC;
  v_recency         NUMERIC;
  v_is_open         BOOLEAN;
  v_active_factor   NUMERIC;
  v_score           NUMERIC;
  v_state           TEXT;
  v_band_distance   NUMERIC;
  -- position (round 5)
  v_role_type       TEXT;
  v_role_position   TEXT;
  v_role_required   BOOLEAN := FALSE;
  v_cand_primary    TEXT;
  v_cand_secondary  TEXT;
  v_position_match  NUMERIC;
  v_components      JSONB;
BEGIN
  -- Fit is recruiters-only: the caller must be the owner it asks about, and a
  -- club or a coach who recruits for a team. Anyone else gets no row at all —
  -- not a zero, not an error — so nothing about a player's fit leaks.
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_owner_id THEN
    RETURN;
  END IF;
  IF NOT public.is_recruiter(auth.uid()) THEN
    RETURN;
  END IF;

  SELECT
    p.playing_category,
    p.current_world_club_id,
    p.open_to_play,
    p.open_to_coach,
    p.open_to_opportunities,
    p.last_active_at,
    p.role,
    p.position,
    p.secondary_position,
    p.coach_specialization
  INTO v_player
  FROM public.profiles p
  WHERE p.id = p_player_id;

  IF NOT FOUND THEN
    -- Player doesn't exist → return zeroed row instead of NULL so the
    -- caller can distinguish "no data" from "low score".
    RETURN QUERY SELECT
      0::NUMERIC,
      'grey'::TEXT,
      jsonb_build_object(
        'gender_match', 0,
        'competition_proximity', 0,
        'availability', 0,
        'recency', 0
      );
    RETURN;
  END IF;

  SELECT current_world_club_id INTO v_owner
  FROM public.profiles
  WHERE id = p_owner_id;

  -- Gender match: 1 if player's category falls in the target's allowed
  -- set, else 0. Null target (no context resolution) → 0.
  v_gender_match := CASE WHEN public._target_accepts_category(p_target, v_player.playing_category) THEN 1 ELSE 0 END;

  -- Competition proximity via curated 1..10 level_band_global.
  v_player_band := public._player_level_band(v_player.current_world_club_id, v_player.playing_category);
  v_viewer_band := public._club_level_band(v_owner.current_world_club_id, p_target);
  IF v_player_band IS NULL OR v_viewer_band IS NULL THEN
    v_proximity := 0;
  ELSE
    v_band_distance := ABS(v_player_band - v_viewer_band);
    v_proximity := GREATEST(0, 1 - v_band_distance / 4.0);
  END IF;

  -- Availability: 0.6 * open_to_X + 0.4 * recency_30d(last_active_at)
  v_is_open := COALESCE(v_player.open_to_play, FALSE)
            OR COALESCE(v_player.open_to_coach, FALSE)
            OR COALESCE(v_player.open_to_opportunities, FALSE);
  v_active_factor := public._recency_30d(v_player.last_active_at);
  v_availability := LEAST(1, GREATEST(0,
    0.6 * (CASE WHEN v_is_open THEN 1 ELSE 0 END) + 0.4 * v_active_factor
  ));

  -- Recency component (10% weight) — uses same last_active_at as
  -- availability since profile_updated_at column isn't populated
  -- consistently yet. Mirrors the TS implementation.
  v_recency := v_active_factor;

  -- Position: the role's position (only when the context is tied to a role
  -- that has one) vs the candidate's. Read with the caller's rights — the
  -- recruiter can read the roles it recruits for.
  IF p_opportunity_id IS NOT NULL THEN
    SELECT o.opportunity_type::text, o.position::text, COALESCE(o.position_required, FALSE)
      INTO v_role_type, v_role_position, v_role_required
      FROM public.opportunities o
     WHERE o.id = p_opportunity_id;
  END IF;

  IF v_role_position IS NOT NULL THEN
    IF v_role_type = 'coach' THEN
      v_cand_primary := CASE WHEN v_player.coach_specialization = 'other' THEN 'other_coach'
                             ELSE NULLIF(btrim(v_player.coach_specialization), '') END;
      v_cand_secondary := NULL;
    ELSE
      v_cand_primary := NULLIF(lower(btrim(v_player.position)), '');
      v_cand_secondary := NULLIF(lower(btrim(v_player.secondary_position)), '');
    END IF;

    v_position_match := CASE
      WHEN v_cand_primary = v_role_position THEN 1
      WHEN v_cand_secondary = v_role_position THEN 0.5
      ELSE 0
    END;

    v_score := LEAST(1, GREATEST(0,
      0.30  * v_proximity +
      0.225 * v_gender_match +
      0.15  * v_availability +
      0.075 * v_recency +
      0.25  * v_position_match
    ));

    IF v_position_match < 1 THEN
      -- Not the primary position → never "Strong".
      v_score := LEAST(v_score, 0.65);
      -- A CONFIRMED wrong position (the candidate has one, and it is neither
      -- primary nor secondary) on a goalkeeper role or a position-required
      -- role → no chip.
      IF v_position_match = 0 AND v_cand_primary IS NOT NULL
         AND (v_role_position = 'goalkeeper' OR v_role_required) THEN
        v_score := LEAST(v_score, 0.39);
      END IF;
    END IF;
  ELSE
    v_score := LEAST(1, GREATEST(0,
      0.40 * v_proximity +
      0.30 * v_gender_match +
      0.20 * v_availability +
      0.10 * v_recency
    ));
  END IF;

  v_state := CASE
    WHEN v_score >= 0.66 THEN 'green'
    WHEN v_score >= 0.40 THEN 'yellow'
    ELSE 'grey'
  END;

  v_components := jsonb_build_object(
    'gender_match', v_gender_match,
    'competition_proximity', v_proximity,
    'availability', v_availability,
    'recency', v_recency
  );
  IF v_role_position IS NOT NULL THEN
    v_components := v_components || jsonb_build_object(
      'position_match', v_position_match,
      'role_position', v_role_position,
      'candidate_position', v_cand_primary,
      'candidate_secondary_position', v_cand_secondary
    );
  END IF;

  RETURN QUERY SELECT v_score, v_state, v_components;
END;
$function$;

-- Grants: identical to live (postgres, authenticated, service_role); never anon/PUBLIC.
REVOKE ALL ON FUNCTION public.compute_club_fit(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_club_fit(uuid, uuid, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.compute_club_fit(uuid, uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_club_fit(uuid, uuid, text, text, uuid) TO service_role;

-- No pre-position score may linger: every cached fit is recomputed on next read.
DELETE FROM public.club_fit_cache;
