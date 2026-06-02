-- ─────────────────────────────────────────────────────────────────────
-- recruiting_context.target_position — position-aware Club Fit (Phase 2A)
-- ─────────────────────────────────────────────────────────────────────
-- Phase 1 made an active scope reshape Community by sought ROLE. Phase 2
-- makes the RANKING within a player scope position-aware: a scope for a
-- "Goalkeeper" opportunity should float goalkeepers to the top.
--
-- Today the scope carries target_category (gender) + target_role
-- (player|coach) but NOT the opportunity's position. This migration
-- captures it, mirroring the proven target_role pattern (20260529180000):
--   - add the column,
--   - server-DERIVE it from opportunities.position inside the activation
--     RPC (never trust a client value), signature unchanged,
--   - backfill existing opportunity-scoped rows.
--
-- Semantics of target_position:
--   non-null  — the opportunity sought a specific position (player opps).
--               Drives the new position_match component in computeClubFit:
--               a SOFT ranking signal (floats matching players up), never
--               a hard filter (a strong off-position player still shows).
--   NULL      — no specific position (coach opps, club/custom contexts,
--               or position-agnostic player opps). position_match is
--               neutral, so ranking is unchanged from Phase 1.
--
-- opportunities.position is the `opportunity_position` enum; we store its
-- text verbatim. Profile sides (profiles.position / secondary_position)
-- are compared client-side in clubFit.

BEGIN;

ALTER TABLE public.recruiting_context
  ADD COLUMN IF NOT EXISTS target_position TEXT;

COMMENT ON COLUMN public.recruiting_context.target_position IS
  'Sought player position (opportunity_position enum text, e.g. goalkeeper/defender/…), derived from the linked opportunity''s position. NULL when the opportunity has no specific position, or for coach/club/custom contexts. Drives the soft position_match ranking component in computeClubFit.';

-- Backfill existing opportunity-scoped rows from their linked opportunity.
UPDATE public.recruiting_context rc
SET target_position = o.position::text
FROM public.opportunities o
WHERE rc.opportunity_id = o.id
  AND rc.type = 'opportunity'
  AND rc.target_position IS DISTINCT FROM o.position::text;

-- ── Activation RPC — now also server-derives + stores target_position ──
-- Signature unchanged (UUID, TEXT, TEXT, TEXT) so no client call changes.
-- The ownership SELECT is extended to also pull `position` alongside
-- opportunity_type.
CREATE OR REPLACE FUNCTION public.activate_opportunity_recruiting_context(
  p_opportunity_id  UUID,
  p_target_category TEXT,
  p_region          TEXT,
  p_label           TEXT
)
RETURNS public.recruiting_context
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_row public.recruiting_context;
  v_target_role TEXT;
  v_target_position TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_opportunity_id IS NULL THEN
    RAISE EXCEPTION 'opportunity_id required' USING ERRCODE = '22023';
  END IF;
  IF p_target_category IS NOT NULL
     AND p_target_category NOT IN ('Men', 'Women', 'Mixed') THEN
    RAISE EXCEPTION 'invalid target_category: %', p_target_category
      USING ERRCODE = '22P02';
  END IF;

  -- Ownership check + derive sought role AND position in one read.
  SELECT opportunity_type::text, position::text
    INTO v_target_role, v_target_position
  FROM public.opportunities
  WHERE id = p_opportunity_id AND club_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'opportunity % not found or not owned by caller', p_opportunity_id
      USING ERRCODE = '42704';
  END IF;

  -- Deactivate every other active context for this owner.
  UPDATE public.recruiting_context
  SET is_active = FALSE
  WHERE owner_id = auth.uid()
    AND is_active = TRUE
    AND NOT (type = 'opportunity' AND opportunity_id = p_opportunity_id);

  SELECT id INTO v_existing_id
  FROM public.recruiting_context
  WHERE owner_id = auth.uid()
    AND type = 'opportunity'
    AND opportunity_id = p_opportunity_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.recruiting_context
    SET
      target_category = p_target_category,
      region          = p_region,
      label           = p_label,
      target_role     = v_target_role,
      target_position = v_target_position,
      is_active       = TRUE
    WHERE id = v_existing_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.recruiting_context (
      owner_id, type, is_active,
      target_category, region, opportunity_id, label, target_role, target_position
    )
    VALUES (
      auth.uid(), 'opportunity', TRUE,
      p_target_category, p_region, p_opportunity_id, p_label, v_target_role, v_target_position
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_opportunity_recruiting_context(
  UUID, TEXT, TEXT, TEXT
) TO authenticated;

COMMIT;
