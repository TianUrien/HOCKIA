-- ─────────────────────────────────────────────────────────────────────
-- recruiting_context.eu_required — EU-eligibility hard filter (Phase 2D)
-- ─────────────────────────────────────────────────────────────────────
-- Phase 2D adds EU passport eligibility as a HARD filter on player scopes,
-- but ONLY when the linked opportunity requires it (opportunities.
-- eu_passport_required = TRUE). When the opportunity does not require an EU
-- passport, this is FALSE and Community is unaffected.
--
-- This mirrors the proven target_role / target_position pattern
-- (20260529180000 / 20260602100000):
--   - add the column,
--   - server-DERIVE it from opportunities.eu_passport_required inside the
--     activation RPC (never trust a client value), signature unchanged,
--   - backfill existing opportunity-scoped rows.
--
-- Semantics of eu_required:
--   TRUE   — the opportunity needs an EU passport. Community filters OUT
--            players whose declared nationality is non-EU. Players with NO
--            nationality on file are KEPT (missing data never hides a
--            candidate — mirrors opportunityEligibility.ts, which allows
--            and nudges rather than blocks on incomplete profiles).
--   FALSE  — no EU requirement (the default for almost every opportunity,
--            all coach/club/custom contexts). No filtering — unchanged.
--
-- The EU membership test itself lives client-side (isEuCountryCode +
-- the countries lookup), exactly as the application-eligibility gate does;
-- this column only carries the per-scope requirement flag.

BEGIN;

ALTER TABLE public.recruiting_context
  ADD COLUMN IF NOT EXISTS eu_required BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.recruiting_context.eu_required IS
  'TRUE when the linked opportunity requires an EU passport (opportunities.eu_passport_required). Drives a HARD EU-eligibility filter on player scopes in Community; players with no nationality on file are kept. FALSE for non-EU opportunities and all coach/club/custom contexts.';

-- Backfill existing opportunity-scoped rows from their linked opportunity.
UPDATE public.recruiting_context rc
SET eu_required = COALESCE(o.eu_passport_required, FALSE)
FROM public.opportunities o
WHERE rc.opportunity_id = o.id
  AND rc.type = 'opportunity'
  AND rc.eu_required IS DISTINCT FROM COALESCE(o.eu_passport_required, FALSE);

-- ── Activation RPC — now also server-derives + stores eu_required ──
-- Signature unchanged (UUID, TEXT, TEXT, TEXT) so no client call changes.
-- The ownership SELECT is extended to also pull `eu_passport_required`
-- alongside opportunity_type + position.
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
  v_eu_required BOOLEAN;
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

  -- Ownership check + derive sought role, position AND EU requirement.
  SELECT opportunity_type::text, position::text, COALESCE(eu_passport_required, FALSE)
    INTO v_target_role, v_target_position, v_eu_required
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
      eu_required     = v_eu_required,
      is_active       = TRUE
    WHERE id = v_existing_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.recruiting_context (
      owner_id, type, is_active,
      target_category, region, opportunity_id, label, target_role, target_position, eu_required
    )
    VALUES (
      auth.uid(), 'opportunity', TRUE,
      p_target_category, p_region, p_opportunity_id, p_label, v_target_role, v_target_position, v_eu_required
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
