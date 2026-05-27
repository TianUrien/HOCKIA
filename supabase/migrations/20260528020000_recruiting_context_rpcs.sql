-- ─────────────────────────────────────────────────────────────────────
-- recruiting_context — atomic activate + create RPCs
-- ─────────────────────────────────────────────────────────────────────
-- Sprint 2 hardening (2026-05-28).
--
-- The client previously did the deactivate-old / activate-new (or
-- deactivate-old / insert-new) swap as two separate calls. Two
-- failure modes existed:
--
--   1. PARTIAL FAILURE — step 1 succeeds, step 2 fails (network
--      blip, transient RLS, 5xx). Owner is left with ZERO active
--      contexts, no recovery path.
--
--   2. MULTI-TAB RACE — two tabs (or a quick re-tap) both run the
--      deactivate, both run the activate/insert, and the second
--      hits the partial unique index `recruiting_context_one_active
--      _per_owner`. The losing tab gets a 23505 from the activate,
--      but the deactivate it ran already wiped the previously-active
--      row. Same degraded zero-actives state as #1.
--
-- Wrapping the swap in a Postgres function turns it into one
-- transaction. Under READ COMMITTED (Supabase default), if two
-- callers race:
--   - the second function's UPDATE blocks on the first's row locks
--   - when the second resumes, its INSERT / UPDATE that would
--     violate the partial unique index gets rejected
--   - the WHOLE function txn rolls back — including its deactivate
--   - the user is left with the winning caller's context active,
--     never in a zero-actives state.
--
-- Both RPCs are SECURITY INVOKER so RLS still applies. The explicit
-- owner_id = auth.uid() filters mirror the policy `USING` clauses;
-- they're not strictly necessary but cheap belt-and-braces and
-- give nicer error messages than a silent zero-rows-affected.

BEGIN;

-- ── set_active_recruiting_context ────────────────────────────────────
-- Atomically swap the active row to `p_id`. Returns the activated
-- row. Raises if the caller doesn't own the target.
CREATE OR REPLACE FUNCTION public.set_active_recruiting_context(p_id UUID)
RETURNS public.recruiting_context
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.recruiting_context;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Existence + ownership check up front so a missing/foreign id
  -- doesn't leave the caller with their previous active deactivated.
  IF NOT EXISTS (
    SELECT 1 FROM public.recruiting_context
    WHERE id = p_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'recruiting context % not found or not owned by caller', p_id
      USING ERRCODE = '42704';
  END IF;

  -- Deactivate every other active row for this owner. Acquires
  -- the row locks that serialise concurrent activate/create calls.
  UPDATE public.recruiting_context
  SET is_active = FALSE
  WHERE owner_id = auth.uid()
    AND id <> p_id
    AND is_active = TRUE;

  -- Promote the target. If a concurrent caller already activated
  -- a different row of this owner, the partial unique index throws
  -- 23505 here and the whole function rolls back.
  UPDATE public.recruiting_context
  SET is_active = TRUE
  WHERE id = p_id AND owner_id = auth.uid()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_active_recruiting_context(UUID) TO authenticated;

-- ── create_active_recruiting_context ─────────────────────────────────
-- Atomically deactivate existing actives + insert a new active row.
-- Returns the inserted row.
CREATE OR REPLACE FUNCTION public.create_active_recruiting_context(
  p_type            TEXT,
  p_target_category TEXT,
  p_competition_id  INTEGER,
  p_region          TEXT,
  p_opportunity_id  UUID,
  p_label           TEXT
)
RETURNS public.recruiting_context
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_row public.recruiting_context;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Enum guard: the table already CHECK-constrains these, but failing
  -- early gives a clearer error to API callers than a generic check
  -- violation deep in the INSERT.
  IF p_type IS NULL OR p_type NOT IN ('club', 'opportunity', 'custom') THEN
    RAISE EXCEPTION 'invalid context type: %', p_type USING ERRCODE = '22P02';
  END IF;
  IF p_target_category IS NOT NULL
     AND p_target_category NOT IN ('Men', 'Women', 'Mixed') THEN
    RAISE EXCEPTION 'invalid target_category: %', p_target_category USING ERRCODE = '22P02';
  END IF;

  UPDATE public.recruiting_context
  SET is_active = FALSE
  WHERE owner_id = auth.uid() AND is_active = TRUE;

  INSERT INTO public.recruiting_context (
    owner_id, type, is_active,
    target_category, competition_id, region, opportunity_id, label
  )
  VALUES (
    auth.uid(), p_type, TRUE,
    p_target_category, p_competition_id, p_region, p_opportunity_id, p_label
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_active_recruiting_context(
  TEXT, TEXT, INTEGER, TEXT, UUID, TEXT
) TO authenticated;

COMMIT;
