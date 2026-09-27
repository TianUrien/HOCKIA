-- Fit respects the role's CATEGORY (founder ruling 2026-09-27, round 6 item 2).
--
-- QA: a women's player read "Strong fit" on a Men's role. Cause (live staging
-- body = 20260930100000_club_fit_position, pg_get_functiondef 2026-09-27):
-- gender_match was WEIGHT-ONLY (30 %, or 22.5 % when the role has a position).
-- An adult_women player on a Men's midfielder role with a primary position
-- match, a close level and "open to play" scored 0.30 + 0.15 + 0.075 + 0.25 =
-- 0.775 >= 0.66 → green. _target_accepts_category('Men', 'adult_women') was
-- correctly FALSE; nothing turned that into a cap. (The client mirror
-- lib/clubFit.ts already forces grey on a confirmed category mismatch.)
--
-- Ruling: women on a Men's role / men on a Women's role → no chip (grey), like
-- a wrong position on a goalkeeper role. Mixed roles accept both. Youth
-- targets (Boys / Girls) follow the same side: Boys takes adult_men / boys /
-- mixed, Girls takes adult_women / girls / mixed (the client sends Men/Women
-- for youth roles already — lib/clubRecruiting fitTarget — this also covers a
-- raw Boys / Girls target). No playing category = honest absence: weight only.
--
-- Change = the round 5 body + a category cap (score ≤ 0.39 → grey), and a raw
-- Boys / Girls target is read as Men / Women for the category check (it used
-- to match nobody; the client never sends one). Nothing else moves: same signature, same RETURNS TABLE, same components keys, same
-- weights. Security unchanged: SECURITY INVOKER (as live), STABLE,
-- SET search_path, the recruiters-only guard first. Grants restated explicitly
-- (identical to live: authenticated + service_role; never anon / PUBLIC).
-- The cache is cleared so no pre-cap score lingers (24 h TTL otherwise).
-- Rollback: supabase/rollbacks/20260930200000_club_fit_category_cap.down.sql
-- Probe:    supabase/tests/security/club_fit_category.probe.sql

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
  -- category (round 6)
  v_cat_target      TEXT;
  v_category_miss   BOOLEAN := FALSE;
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
  -- Round 6: a raw youth target reads as its side (Boys → Men, Girls → Women)
  -- so it is never "no match" for everyone.
  v_cat_target := CASE p_target WHEN 'Boys' THEN 'Men' WHEN 'Girls' THEN 'Women' ELSE p_target END;
  v_gender_match := CASE WHEN public._target_accepts_category(v_cat_target, v_player.playing_category) THEN 1 ELSE 0 END;

  -- Category cap (round 6): a CONFIRMED category mismatch — the player has a
  -- playing category and the role's team does not take it (women on a Men's
  -- role, men on a Women's role) — is a no-chip miss, like a wrong position
  -- on a goalkeeper role. Mixed takes every category. Youth targets follow
  -- the same side (Boys → Men's pool: adult_men / boys / mixed; Girls →
  -- Women's pool: adult_women / girls / mixed). No category on the profile
  -- is honest absence: weight only, never capped for that reason.
  IF v_cat_target IN ('Men', 'Women')
     AND NULLIF(btrim(v_player.playing_category), '') IS NOT NULL
     AND NOT public._target_accepts_category(v_cat_target, v_player.playing_category) THEN
    v_category_miss := TRUE;
  END IF;

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

  IF v_category_miss THEN
    v_score := LEAST(v_score, 0.39);
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

-- No pre-category-cap score may linger: every cached fit is recomputed on next read.
DELETE FROM public.club_fit_cache;
