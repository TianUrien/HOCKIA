-- ─────────────────────────────────────────────────────────────────────
-- recruiting_context.target_specialists (Matching Increment #3.2 enabler)
-- ─────────────────────────────────────────────────────────────────────
-- #3.1 captured specialist skills on players (specialist_skills) and on
-- opportunities (specialist_skills_wanted). #3.2 lets the 🎯 Fit lens
-- consume them: a sought specialism boosts players who hold it, folded
-- into the position_match component of computeClubFit.
--
-- To compare client-side, the active scope must carry the opportunity's
-- specialist_skills_wanted — same proven pattern as position / location.
-- NULL/empty for coach/club/custom contexts → no specialist signal.

BEGIN;

ALTER TABLE public.recruiting_context
  ADD COLUMN IF NOT EXISTS target_specialists TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.recruiting_context.target_specialists IS
  'Specialist skills the opportunity seeks (opportunities.specialist_skills_wanted), derived from the linked opportunity. Drives the Fit-lens specialist boost. Empty for coach/club/custom contexts.';

-- Backfill existing opportunity-scoped rows.
UPDATE public.recruiting_context rc
SET target_specialists = COALESCE(o.specialist_skills_wanted, '{}')
FROM public.opportunities o
WHERE rc.opportunity_id = o.id
  AND rc.type = 'opportunity'
  AND rc.target_specialists IS DISTINCT FROM COALESCE(o.specialist_skills_wanted, '{}');

-- ── Activation RPC — now also derives target_specialists ──
-- Signature unchanged (UUID, TEXT, TEXT, TEXT).
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
  v_location_country TEXT;
  v_start_date DATE;
  v_specialists TEXT[];
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

  -- Ownership check + derive role, position, EU, location, start, specialists.
  SELECT opportunity_type::text, position::text, COALESCE(eu_passport_required, FALSE),
         location_country, start_date, COALESCE(specialist_skills_wanted, '{}')
    INTO v_target_role, v_target_position, v_eu_required,
         v_location_country, v_start_date, v_specialists
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
      target_category         = p_target_category,
      region                  = p_region,
      label                   = p_label,
      target_role             = v_target_role,
      target_position         = v_target_position,
      eu_required             = v_eu_required,
      target_location_country = v_location_country,
      target_start_date       = v_start_date,
      target_specialists      = v_specialists,
      is_active               = TRUE
    WHERE id = v_existing_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.recruiting_context (
      owner_id, type, is_active,
      target_category, region, opportunity_id, label, target_role, target_position, eu_required,
      target_location_country, target_start_date, target_specialists
    )
    VALUES (
      auth.uid(), 'opportunity', TRUE,
      p_target_category, p_region, p_opportunity_id, p_label, v_target_role, v_target_position, v_eu_required,
      v_location_country, v_start_date, v_specialists
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
