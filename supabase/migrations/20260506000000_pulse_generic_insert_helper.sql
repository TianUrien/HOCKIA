-- =========================================================================
-- L0 — Generic _insert_pulse_item helper (Loop Layer foundation)
-- =========================================================================
-- The 1B.3 helper `_maybe_insert_snapshot_gain_celebration` hard-coded
-- item_type, priority, and the 7-day cap. The Loop layer needs three new
-- card types (friendship_reference_opportunity, availability_check_in,
-- profile_viewed_by_recruiters) that all want the same "frequency-capped
-- INSERT" semantics with different parameters.
--
-- Extracting a generic helper here so the new card-specific functions can
-- delegate. The original celebration helper is refactored to call it,
-- preserving exact behavior (item_type='snapshot_gain_celebration',
-- priority=2, 7-day cap).
--
-- All Loop card-type triggers/crons call _insert_pulse_item directly with
-- their own item_type / priority / frequency window.
-- =========================================================================

SET search_path = public;

CREATE OR REPLACE FUNCTION public._insert_pulse_item(
  p_user_id UUID,
  p_item_type TEXT,
  p_priority SMALLINT,
  p_metadata JSONB,
  p_frequency_days INT DEFAULT 7
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent_count INT;
BEGIN
  -- Per-user-per-card-type frequency cap. The window is parameterised so
  -- different card types can use different cadences (celebrations: 7d,
  -- check-ins: 6d, etc.). Pass 0 to skip the cap entirely.
  IF p_frequency_days > 0 THEN
    SELECT COUNT(*) INTO v_recent_count
      FROM public.user_pulse_items
     WHERE user_id = p_user_id
       AND item_type = p_item_type
       AND created_at > timezone('utc', now()) - (p_frequency_days || ' days')::INTERVAL;

    IF v_recent_count > 0 THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO public.user_pulse_items (user_id, item_type, priority, metadata)
  VALUES (
    p_user_id,
    p_item_type,
    p_priority,
    COALESCE(p_metadata, '{}'::JSONB)
  );

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public._insert_pulse_item IS
  'Generic frequency-capped Pulse insert. Returns true on insert, false when the cap blocks it. Underscore prefix is style-only — paired with a REVOKE EXECUTE FROM PUBLIC at the bottom of this file.';

-- =========================================================================
-- Refactor _maybe_insert_snapshot_gain_celebration to delegate
-- =========================================================================
-- Behavior preserved exactly: same item_type, same priority, same 7-day
-- cap, same metadata shape. Existing 4 trigger functions
-- (celebrate_first_*) require no change because they only know about the
-- helper's signature, not its body.

CREATE OR REPLACE FUNCTION public._maybe_insert_snapshot_gain_celebration(
  p_user_id UUID,
  p_signal TEXT,
  p_metadata JSONB DEFAULT '{}'::JSONB
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._insert_pulse_item(
    p_user_id,
    'snapshot_gain_celebration',
    2::SMALLINT,
    jsonb_build_object('signal', p_signal) || COALESCE(p_metadata, '{}'::JSONB),
    7
  );
END;
$$;

-- Keep the new helper private — Postgres grants EXECUTE to PUBLIC by
-- default, and PostgREST exposes any function in the public schema. The
-- underscore prefix is purely cosmetic; this REVOKE is the actual gate.
REVOKE EXECUTE ON FUNCTION public._insert_pulse_item(UUID, TEXT, SMALLINT, JSONB, INT) FROM PUBLIC;
