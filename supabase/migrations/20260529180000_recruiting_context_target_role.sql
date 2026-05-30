-- ─────────────────────────────────────────────────────────────────────
-- recruiting_context.target_role — role-compatibility gate for Club Fit
-- ─────────────────────────────────────────────────────────────────────
-- Trust bug: a recruiter scoping to a COACH-seeking opportunity saw
-- PLAYER cards labelled "Possible fit". Root cause — the recruiting
-- context modelled only target_category (gender), never the
-- opportunity's sought role, so ClubFit (which only does player-fit
-- math) scored every category-matching player regardless of whether
-- the opportunity wanted players or coaches.
--
-- Fix: capture the opportunity's sought role on the context so the
-- client can gate fit labels to player-seeking contexts only. We
-- server-DERIVE it from opportunities.opportunity_type inside the
-- activation RPC (never trust a client-supplied role), keeping the
-- RPC signature unchanged so no client call has to change.
--
-- Semantics of target_role:
--   'player'  — recruiting players (club-team contexts + player opps).
--               ClubFit labels apply.
--   'coach'   — recruiting coaches. ClubFit (player-only math) must
--               NOT label anyone; the client gates fit chips off.
--   NULL      — club-derived / custom contexts with no explicit role.
--               Treated as player-seeking by the client (preserves
--               today's correct club→player behaviour).

BEGIN;

ALTER TABLE public.recruiting_context
  ADD COLUMN IF NOT EXISTS target_role TEXT;

COMMENT ON COLUMN public.recruiting_context.target_role IS
  'Sought role for this context (player | coach | …), derived from the linked opportunity''s opportunity_type. NULL for club/custom contexts (treated as player-seeking). Drives the role-compatibility gate on Club Fit labels.';

-- Backfill existing opportunity-scoped rows from their linked
-- opportunity. Club/custom rows stay NULL (player-seeking default).
UPDATE public.recruiting_context rc
SET target_role = o.opportunity_type::text
FROM public.opportunities o
WHERE rc.opportunity_id = o.id
  AND rc.type = 'opportunity'
  AND rc.target_role IS DISTINCT FROM o.opportunity_type::text;

-- ── Activation RPC — now server-derives + stores target_role ────────
-- Same signature (UUID, TEXT, TEXT, TEXT) so the client call is
-- unchanged. The ownership SELECT is extended to also pull
-- opportunity_type, which becomes target_role on the context row.
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

  -- Ownership check + derive the sought role in one read. The
  -- opportunity_type enum ('player' | 'coach' | …) is the canonical
  -- sought-role; we store it verbatim as target_role. SELECT … INTO
  -- with NOT FOUND replaces the old EXISTS check.
  SELECT opportunity_type::text INTO v_target_role
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
      is_active       = TRUE
    WHERE id = v_existing_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.recruiting_context (
      owner_id, type, is_active,
      target_category, region, opportunity_id, label, target_role
    )
    VALUES (
      auth.uid(), 'opportunity', TRUE,
      p_target_category, p_region, p_opportunity_id, p_label, v_target_role
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
