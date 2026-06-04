-- ─────────────────────────────────────────────────────────────────────
-- Opportunity intent — level_sought + compensation + recruitment_problem
-- (Matching Increment #4a — recruiter-side capture)
-- ─────────────────────────────────────────────────────────────────────
-- #2.1 captured the CANDIDATE's level_target + opportunity_preference, but
-- they sat unused because the opportunity had nothing to match against.
-- This adds the recruiter side so the Interested lens can score level +
-- compensation (#4b), plus the coach-worded "what are you solving?" picker
-- (captured now; its re-weighting is #6).
--
--   opportunities.level_sought  — level of TALENT sought (not the club's).
--       elite | high_performance | competitive | development. Hybrid: the
--       form pre-fills from the club's league band, recruiter overrides.
--   opportunities.compensation  — paid | unpaid_development | either.
--   opportunities.recruitment_problem — the priority picker (one value).
--
-- All NULLABLE; carried onto the active scope (same proven pattern as
-- position/location/specialists) so the lens can compare client-side.

BEGIN;

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS level_sought TEXT,
  ADD COLUMN IF NOT EXISTS compensation TEXT,
  ADD COLUMN IF NOT EXISTS recruitment_problem TEXT;

ALTER TABLE public.recruiting_context
  ADD COLUMN IF NOT EXISTS target_level TEXT,
  ADD COLUMN IF NOT EXISTS target_compensation TEXT,
  ADD COLUMN IF NOT EXISTS target_problem TEXT;

COMMENT ON COLUMN public.opportunities.level_sought IS
  'Level of talent sought (elite/high_performance/competitive/development). Pre-filled from the club league band, recruiter-overridable. Drives the Interested-lens level alignment vs the candidate''s level_target.';
COMMENT ON COLUMN public.opportunities.compensation IS
  'paid | unpaid_development | either. Matches the candidate''s opportunity_preference.';
COMMENT ON COLUMN public.opportunities.recruitment_problem IS
  'Coach-worded recruitment priority (replace_player/raise_level/best_available/young_talent/leadership/urgent). Captured now; re-weights the match in #6.';
COMMENT ON COLUMN public.recruiting_context.target_level IS 'Derived from the linked opportunity''s level_sought.';
COMMENT ON COLUMN public.recruiting_context.target_compensation IS 'Derived from the linked opportunity''s compensation.';
COMMENT ON COLUMN public.recruiting_context.target_problem IS 'Derived from the linked opportunity''s recruitment_problem (for #6 re-weighting).';

-- Backfill existing opportunity-scoped rows.
UPDATE public.recruiting_context rc
SET target_level       = o.level_sought,
    target_compensation = o.compensation,
    target_problem      = o.recruitment_problem
FROM public.opportunities o
WHERE rc.opportunity_id = o.id
  AND rc.type = 'opportunity'
  AND (rc.target_level IS DISTINCT FROM o.level_sought
       OR rc.target_compensation IS DISTINCT FROM o.compensation
       OR rc.target_problem IS DISTINCT FROM o.recruitment_problem);

-- ── Activation RPC — now also derives level / compensation / problem ──
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
  v_level TEXT;
  v_compensation TEXT;
  v_problem TEXT;
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

  -- Ownership check + derive everything the lenses need in one read.
  SELECT opportunity_type::text, position::text, COALESCE(eu_passport_required, FALSE),
         location_country, start_date, COALESCE(specialist_skills_wanted, '{}'),
         level_sought, compensation, recruitment_problem
    INTO v_target_role, v_target_position, v_eu_required,
         v_location_country, v_start_date, v_specialists,
         v_level, v_compensation, v_problem
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
      target_level            = v_level,
      target_compensation     = v_compensation,
      target_problem          = v_problem,
      is_active               = TRUE
    WHERE id = v_existing_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.recruiting_context (
      owner_id, type, is_active,
      target_category, region, opportunity_id, label, target_role, target_position, eu_required,
      target_location_country, target_start_date, target_specialists,
      target_level, target_compensation, target_problem
    )
    VALUES (
      auth.uid(), 'opportunity', TRUE,
      p_target_category, p_region, p_opportunity_id, p_label, v_target_role, v_target_position, v_eu_required,
      v_location_country, v_start_date, v_specialists,
      v_level, v_compensation, v_problem
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
