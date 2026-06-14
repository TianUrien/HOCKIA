-- ─────────────────────────────────────────────────────────────────────
-- Phase 3a — Recruiting Intent: per-criterion MUST-HAVE hardness flags
-- (Matching Increment #7 — weighted must / nice-to-have criteria)
-- ─────────────────────────────────────────────────────────────────────
-- Phase 3 lets a recruiter mark a soft criterion as a MUST-HAVE. A
-- must-have EXPLICIT mismatch hard-caps the candidate to "Out of scope"
-- in the verdict (and hard-filters nl-search + the apply-gate, #3e/#3f);
-- a blank candidate field stays NEUTRAL — never fails — preserving
-- HOCKIA's honest-absence rule. NICE-to-have is the default (= today's
-- soft, weighted behavior).
--
-- Category (gender) and EU passport are ALREADY hard (clubFit
-- categoryMismatch → grey at clubFit.ts; eu_required Community filter)
-- and stay permanently hard — they are NOT exposed as toggles here.
--
-- The six toggle-able dimensions mirror the existing target_* criteria
-- the lenses already score:
--   position · level · compensation · location · availability(start) · specialists
--
-- Pattern follows 20260604100000 EXACTLY: defaulted flags on the
-- opportunity (capture) + recruiting_context (the active scope the
-- verdict reads), derived + mirrored by the single activation RPC.
-- Default FALSE = every criterion is NICE = today's soft behavior, so
-- existing opportunities and active scopes are unchanged after backfill.

BEGIN;

-- ── Capture side: the opportunity carries each criterion's hardness ──
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS position_required     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS level_required        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS compensation_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS location_required     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS availability_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS specialists_required  BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Active-scope side: the verdict reads hardness off the active row ──
ALTER TABLE public.recruiting_context
  ADD COLUMN IF NOT EXISTS position_required     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS level_required        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS compensation_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS location_required     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS availability_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS specialists_required  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.opportunities.position_required IS
  'MUST-HAVE: an explicit position mismatch hard-caps the candidate to "Out of scope". FALSE = nice-to-have (soft fit). Blank candidate stays neutral.';
COMMENT ON COLUMN public.opportunities.level_required IS
  'MUST-HAVE: an explicit level mismatch hard-caps to "Out of scope". FALSE = nice-to-have.';
COMMENT ON COLUMN public.opportunities.compensation_required IS
  'MUST-HAVE: an explicit compensation mismatch hard-caps to "Out of scope". FALSE = nice-to-have.';
COMMENT ON COLUMN public.opportunities.location_required IS
  'MUST-HAVE: an explicit location/relocation mismatch hard-caps to "Out of scope". FALSE = nice-to-have.';
COMMENT ON COLUMN public.opportunities.availability_required IS
  'MUST-HAVE: an explicit availability (start_date) mismatch hard-caps to "Out of scope". FALSE = nice-to-have.';
COMMENT ON COLUMN public.opportunities.specialists_required IS
  'MUST-HAVE: an explicit specialist-skills mismatch hard-caps to "Out of scope". FALSE = nice-to-have.';

COMMENT ON COLUMN public.recruiting_context.position_required IS 'Derived from the linked opportunity''s position_required.';
COMMENT ON COLUMN public.recruiting_context.level_required IS 'Derived from the linked opportunity''s level_required.';
COMMENT ON COLUMN public.recruiting_context.compensation_required IS 'Derived from the linked opportunity''s compensation_required.';
COMMENT ON COLUMN public.recruiting_context.location_required IS 'Derived from the linked opportunity''s location_required.';
COMMENT ON COLUMN public.recruiting_context.availability_required IS 'Derived from the linked opportunity''s availability_required.';
COMMENT ON COLUMN public.recruiting_context.specialists_required IS 'Derived from the linked opportunity''s specialists_required.';

-- Backfill existing opportunity-scoped rows (no-op today since all flags
-- default FALSE, but keeps the snapshot consistent + idempotent).
UPDATE public.recruiting_context rc
SET position_required     = o.position_required,
    level_required        = o.level_required,
    compensation_required = o.compensation_required,
    location_required     = o.location_required,
    availability_required = o.availability_required,
    specialists_required  = o.specialists_required
FROM public.opportunities o
WHERE rc.opportunity_id = o.id
  AND rc.type = 'opportunity'
  AND (rc.position_required     IS DISTINCT FROM o.position_required
       OR rc.level_required        IS DISTINCT FROM o.level_required
       OR rc.compensation_required IS DISTINCT FROM o.compensation_required
       OR rc.location_required     IS DISTINCT FROM o.location_required
       OR rc.availability_required IS DISTINCT FROM o.availability_required
       OR rc.specialists_required  IS DISTINCT FROM o.specialists_required);

-- ── Activation RPC — now also derives the six hardness flags ──
-- CREATE OR REPLACE on the LATEST signature (supersedes 20260604100000).
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
  v_position_required BOOLEAN;
  v_level_required BOOLEAN;
  v_compensation_required BOOLEAN;
  v_location_required BOOLEAN;
  v_availability_required BOOLEAN;
  v_specialists_required BOOLEAN;
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
         level_sought, compensation, recruitment_problem,
         COALESCE(position_required, FALSE), COALESCE(level_required, FALSE),
         COALESCE(compensation_required, FALSE), COALESCE(location_required, FALSE),
         COALESCE(availability_required, FALSE), COALESCE(specialists_required, FALSE)
    INTO v_target_role, v_target_position, v_eu_required,
         v_location_country, v_start_date, v_specialists,
         v_level, v_compensation, v_problem,
         v_position_required, v_level_required,
         v_compensation_required, v_location_required,
         v_availability_required, v_specialists_required
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
      position_required       = v_position_required,
      level_required          = v_level_required,
      compensation_required   = v_compensation_required,
      location_required       = v_location_required,
      availability_required   = v_availability_required,
      specialists_required    = v_specialists_required,
      is_active               = TRUE
    WHERE id = v_existing_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.recruiting_context (
      owner_id, type, is_active,
      target_category, region, opportunity_id, label, target_role, target_position, eu_required,
      target_location_country, target_start_date, target_specialists,
      target_level, target_compensation, target_problem,
      position_required, level_required, compensation_required,
      location_required, availability_required, specialists_required
    )
    VALUES (
      auth.uid(), 'opportunity', TRUE,
      p_target_category, p_region, p_opportunity_id, p_label, v_target_role, v_target_position, v_eu_required,
      v_location_country, v_start_date, v_specialists,
      v_level, v_compensation, v_problem,
      v_position_required, v_level_required, v_compensation_required,
      v_location_required, v_availability_required, v_specialists_required
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
