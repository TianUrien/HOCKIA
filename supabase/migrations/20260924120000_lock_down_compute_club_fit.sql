-- Founder ruling 2026-09-24: fit is clubs-only. compute_club_fit was
-- SECURITY INVOKER with EXECUTE granted to anon and authenticated and no
-- guard inside ("the caller's responsibility"), so any signed-in player —
-- or an anonymous API call — could read a fit score for any pair.
--
-- 1. No anonymous execution of any fit function or its helpers.
-- 2. compute_club_fit returns NOTHING unless the caller IS the owner
--    (auth.uid() = p_owner_id) and that profile is a club or a coach.
--    get_club_fit / get_club_fit_batch already pass auth.uid() as the owner,
--    so the two real callers keep working unchanged.

REVOKE EXECUTE ON FUNCTION public.compute_club_fit(uuid, uuid, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_club_fit(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_club_fit_batch(uuid[], uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._club_fit_context_hash(text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._upsert_club_fit_cache(uuid, uuid, text, numeric, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._club_level_band(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._player_level_band(uuid, text) FROM anon;

CREATE OR REPLACE FUNCTION public.compute_club_fit(p_owner_id uuid, p_player_id uuid, p_target text, p_region text, p_opportunity_id uuid)
 RETURNS TABLE(score numeric, state text, components jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role     TEXT;
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
  -- Fit is clubs-only: the caller must be the owner it asks about, and a
  -- club or a coach. Anyone else gets no row at all — not a zero, not an
  -- error — so nothing about a player's fit leaks to a player.
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_owner_id THEN
    RETURN;
  END IF;
  SELECT p.role INTO v_caller_role FROM public.profiles p WHERE p.id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'club' AND v_caller_role IS DISTINCT FROM 'coach' THEN
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
