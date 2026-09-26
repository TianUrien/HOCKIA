-- Track C · step 4 — fit is computed only for recruiters (founder ruling 2026-09-26:
-- "fit counts only coaches who recruit").
--
-- compute_club_fit answered any club OR any coach. A coach who is only looking for a
-- role is a candidate, not a recruiter, and gets no row now — same shape as every
-- other refusal (no row, not a zero). public.is_recruiter(uid) = club, or coach with
-- coach_recruits_for_team, and not hidden; it exists on prod and staging.
--
-- Body identical to live (md5 7ae9848d… on prod and staging, 2026-09-26) except the
-- caller check. CREATE OR REPLACE keeps the existing grants (20260924120000/121000).

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
    p.last_active_at
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

  v_score := LEAST(1, GREATEST(0,
    0.40 * v_proximity +
    0.30 * v_gender_match +
    0.20 * v_availability +
    0.10 * v_recency
  ));

  v_state := CASE
    WHEN v_score >= 0.66 THEN 'green'
    WHEN v_score >= 0.40 THEN 'yellow'
    ELSE 'grey'
  END;

  RETURN QUERY SELECT
    v_score,
    v_state,
    jsonb_build_object(
      'gender_match', v_gender_match,
      'competition_proximity', v_proximity,
      'availability', v_availability,
      'recency', v_recency
    );
END;
$function$;
