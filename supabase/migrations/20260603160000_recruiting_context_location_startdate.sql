-- ─────────────────────────────────────────────────────────────────────
-- recruiting_context.target_location_country + target_start_date
-- (Matching Increment #2.2 — the 🤝 Interested lens enabler)
-- ─────────────────────────────────────────────────────────────────────
-- The Interested lens scores a candidate's intent (relocation willingness,
-- countries open/excluded, availability) against the opportunity they're
-- being matched to. To compare client-side without a join, the active
-- scope must carry the opportunity's LOCATION and START DATE — same proven
-- pattern as target_role / target_position / eu_required.
--
--   target_location_country — opportunities.location_country (TEXT, the
--     raw country string, e.g. 'Netherlands'). The mobility component
--     compares it (with an England→UK alias on the client) to the
--     candidate's home country + open/excluded country lists.
--   target_start_date — opportunities.start_date (DATE). The availability
--     component compares it to the candidate's available_from. NULL when
--     the opportunity has no start date (most do today) → availability
--     stays neutral.
--
-- Columns are NULLABLE (an opportunity may lack either); coach/club/custom
-- contexts leave them NULL → the Interested lens is simply not applicable.

BEGIN;

ALTER TABLE public.recruiting_context
  ADD COLUMN IF NOT EXISTS target_location_country TEXT,
  ADD COLUMN IF NOT EXISTS target_start_date DATE;

COMMENT ON COLUMN public.recruiting_context.target_location_country IS
  'Opportunity location_country (raw text), derived from the linked opportunity. Drives the Interested-lens mobility match. NULL for coach/club/custom contexts.';
COMMENT ON COLUMN public.recruiting_context.target_start_date IS
  'Opportunity start_date, derived from the linked opportunity. Drives the Interested-lens availability check. NULL when the opportunity has no start date.';

-- Backfill existing opportunity-scoped rows from their linked opportunity.
UPDATE public.recruiting_context rc
SET target_location_country = o.location_country,
    target_start_date       = o.start_date
FROM public.opportunities o
WHERE rc.opportunity_id = o.id
  AND rc.type = 'opportunity'
  AND (rc.target_location_country IS DISTINCT FROM o.location_country
       OR rc.target_start_date IS DISTINCT FROM o.start_date);

-- ── Activation RPC — now also derives location_country + start_date ──
-- Signature unchanged (UUID, TEXT, TEXT, TEXT). The ownership SELECT is
-- extended to also pull location_country + start_date.
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

  -- Ownership check + derive sought role, position, EU, location + start.
  SELECT opportunity_type::text, position::text, COALESCE(eu_passport_required, FALSE),
         location_country, start_date
    INTO v_target_role, v_target_position, v_eu_required,
         v_location_country, v_start_date
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
      is_active               = TRUE
    WHERE id = v_existing_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.recruiting_context (
      owner_id, type, is_active,
      target_category, region, opportunity_id, label, target_role, target_position, eu_required,
      target_location_country, target_start_date
    )
    VALUES (
      auth.uid(), 'opportunity', TRUE,
      p_target_category, p_region, p_opportunity_id, p_label, v_target_role, v_target_position, v_eu_required,
      v_location_country, v_start_date
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
