-- =========================================================================
-- Pulse helper RPCs (v5 plan, Phase 1B.2)
-- =========================================================================
-- Five helper functions exposed to the frontend hook (`useMyPulse`):
--
--   get_my_pulse(p_limit)              → owner's active pulse items
--   mark_pulse_seen(p_pulse_ids[])     → batch mark on feed render
--   mark_pulse_clicked(p_pulse_id)     → CTA tap (implies seen)
--   mark_pulse_dismissed(p_pulse_id)   → explicit dismiss
--   mark_pulse_action_completed(...)   → suggested action was actually taken
--
-- The mutating RPCs are SECURITY DEFINER + auth.uid() check so they can
-- update lifecycle timestamps without going through a wide UPDATE policy
-- (the existing user_pulse_items_update_self policy allows owners to set
-- ANY column, which is too permissive — these RPCs are the canonical
-- write path that limits writes to lifecycle timestamps only).
--
-- Idempotent: COALESCE() on each timestamp prevents re-stamping the
-- first-seen / first-clicked moments, so analytics retains the original
-- funnel boundary even if the frontend double-fires.
-- =========================================================================

SET search_path = public;

-- =========================================================================
-- get_my_pulse — read active items for the calling user
-- =========================================================================
-- SELECT goes through RLS (user_pulse_items_select_self) — SECURITY INVOKER
-- is the right default. The wrapper mostly exists for ergonomics + a
-- consistent limit clamp.
CREATE OR REPLACE FUNCTION public.get_my_pulse(p_limit INT DEFAULT 20)
RETURNS SETOF public.user_pulse_items
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT *
    FROM public.user_pulse_items
   WHERE user_id = auth.uid()
     AND dismissed_at IS NULL
   ORDER BY priority ASC, created_at DESC
   LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.get_my_pulse(INT) TO authenticated;

COMMENT ON FUNCTION public.get_my_pulse IS
  'Returns active (non-dismissed) pulse items for the calling user, newest first within priority bands. Limit clamped to [1, 50]. Owner-only by RLS.';

-- =========================================================================
-- mark_pulse_seen — batch mark when feed renders
-- =========================================================================
-- Idempotent: only stamps seen_at when previously NULL, preserving the
-- original first-render timestamp for funnel analytics.
CREATE OR REPLACE FUNCTION public.mark_pulse_seen(p_pulse_ids UUID[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_pulse_ids IS NULL OR array_length(p_pulse_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.user_pulse_items
     SET seen_at = timezone('utc', now())
   WHERE id = ANY(p_pulse_ids)
     AND user_id = auth.uid()
     AND seen_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_pulse_seen(UUID[]) TO authenticated;

COMMENT ON FUNCTION public.mark_pulse_seen IS
  'Batch mark pulse items as seen. Idempotent (only stamps seen_at when previously NULL). Returns count of rows actually updated.';

-- =========================================================================
-- mark_pulse_clicked — single mark when CTA tapped
-- =========================================================================
-- Implies seen — also stamps seen_at if NULL. Both timestamps are
-- COALESCE'd so the original first-touch moments are preserved.
CREATE OR REPLACE FUNCTION public.mark_pulse_clicked(p_pulse_id UUID)
RETURNS public.user_pulse_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_row public.user_pulse_items;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.user_pulse_items
     SET clicked_at = COALESCE(clicked_at, v_now),
         seen_at = COALESCE(seen_at, v_now)
   WHERE id = p_pulse_id
     AND user_id = auth.uid()
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pulse item not found or not owned by caller';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_pulse_clicked(UUID) TO authenticated;

COMMENT ON FUNCTION public.mark_pulse_clicked IS
  'Mark a single pulse item as clicked (implies seen). Idempotent on both timestamps via COALESCE. Returns the updated row.';

-- =========================================================================
-- mark_pulse_dismissed — single mark when explicitly dismissed
-- =========================================================================
-- Frontend filters dismissed items out of the feed, so calling this
-- effectively removes the card from view. Idempotent.
CREATE OR REPLACE FUNCTION public.mark_pulse_dismissed(p_pulse_id UUID)
RETURNS public.user_pulse_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_row public.user_pulse_items;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.user_pulse_items
     SET dismissed_at = COALESCE(dismissed_at, v_now),
         seen_at = COALESCE(seen_at, v_now)
   WHERE id = p_pulse_id
     AND user_id = auth.uid()
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pulse item not found or not owned by caller';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_pulse_dismissed(UUID) TO authenticated;

COMMENT ON FUNCTION public.mark_pulse_dismissed IS
  'Mark a single pulse item as dismissed (also stamps seen_at if NULL). Idempotent.';

-- =========================================================================
-- mark_pulse_action_completed — distinct from clicked
-- =========================================================================
-- Some Pulse cards have multi-step actions (e.g. "Ask Maria for a vouch"
-- — clicked = opened the modal, action_completed = sent the request).
-- Tracking these separately lets analytics measure the click-through →
-- action funnel.
CREATE OR REPLACE FUNCTION public.mark_pulse_action_completed(p_pulse_id UUID)
RETURNS public.user_pulse_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_row public.user_pulse_items;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.user_pulse_items
     SET action_completed_at = COALESCE(action_completed_at, v_now),
         clicked_at = COALESCE(clicked_at, v_now),
         seen_at = COALESCE(seen_at, v_now)
   WHERE id = p_pulse_id
     AND user_id = auth.uid()
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pulse item not found or not owned by caller';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_pulse_action_completed(UUID) TO authenticated;

COMMENT ON FUNCTION public.mark_pulse_action_completed IS
  'Mark a single pulse item as action_completed (also stamps clicked_at + seen_at if NULL). Idempotent. Used for cards where clicking is distinct from completing the suggested action.';
