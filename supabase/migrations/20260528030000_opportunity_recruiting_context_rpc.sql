-- ─────────────────────────────────────────────────────────────────────
-- recruiting_context — per-opportunity auto-context
-- ─────────────────────────────────────────────────────────────────────
-- Sprint 3 of the recruitment intelligence layer (2026-05-28).
--
-- Adds:
--   1. A partial unique index keyed on (owner_id, opportunity_id)
--      for rows with type='opportunity'. Prevents the find-or-create
--      RPC from accidentally inserting two rows for the same
--      opportunity if two tabs race.
--
--   2. The `activate_opportunity_recruiting_context` RPC — a single
--      idempotent server call that:
--        - finds the owner's existing context row for this opportunity
--          (if any), refreshes its target/region/label so changes to
--          the underlying opportunity propagate, then atomically
--          activates it; OR
--        - inserts a brand-new active row scoped to the opportunity.
--      All inside one txn so the partial unique index never sees a
--      "two actives at once" state.
--
-- When a recruiter opens their Applicants page for an opportunity,
-- the client calls this RPC and the active recruiting_context gets
-- scoped to that opportunity. Fit chips + carousel filtering then
-- narrow to the opportunity's gender/region instead of the club's
-- broader profile-derived "Mixed".

BEGIN;

-- One opportunity context per (owner, opportunity). The IS NOT NULL
-- guard means deleted opportunities (FK is ON DELETE SET NULL on the
-- base table) don't lock out future inserts.
CREATE UNIQUE INDEX IF NOT EXISTS recruiting_context_one_per_opportunity
  ON public.recruiting_context (owner_id, opportunity_id)
  WHERE type = 'opportunity' AND opportunity_id IS NOT NULL;

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

  -- Ensure caller owns the opportunity. RLS on opportunities would
  -- also gate this, but checking explicitly gives a clearer error
  -- and avoids creating an orphan context row.
  IF NOT EXISTS (
    SELECT 1 FROM public.opportunities
    WHERE id = p_opportunity_id AND club_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'opportunity % not found or not owned by caller', p_opportunity_id
      USING ERRCODE = '42704';
  END IF;

  -- Deactivate every other active context for this owner. Acquires
  -- the row locks that serialise concurrent activate calls.
  UPDATE public.recruiting_context
  SET is_active = FALSE
  WHERE owner_id = auth.uid()
    AND is_active = TRUE
    AND NOT (type = 'opportunity' AND opportunity_id = p_opportunity_id);

  -- Find-or-create the opportunity context row. The partial unique
  -- index makes the existing-row lookup deterministic.
  SELECT id INTO v_existing_id
  FROM public.recruiting_context
  WHERE owner_id = auth.uid()
    AND type = 'opportunity'
    AND opportunity_id = p_opportunity_id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Refresh fields in case the underlying opportunity's gender /
    -- location changed since the last activation, then activate.
    UPDATE public.recruiting_context
    SET
      target_category = p_target_category,
      region          = p_region,
      label           = p_label,
      is_active       = TRUE
    WHERE id = v_existing_id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.recruiting_context (
      owner_id, type, is_active,
      target_category, region, opportunity_id, label
    )
    VALUES (
      auth.uid(), 'opportunity', TRUE,
      p_target_category, p_region, p_opportunity_id, p_label
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
