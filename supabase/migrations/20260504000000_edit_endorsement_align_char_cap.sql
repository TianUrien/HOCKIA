-- =========================================================================
-- Align edit_endorsement char cap with the trigger + modal cap (1200 -> 800)
-- =========================================================================
-- 20260430030000_references_bug_bundle.sql tightened endorsement_text from
-- 1200 to 800 chars across:
--   - the table CHECK constraint
--   - the handle_profile_reference_state trigger (LEFT(..., 800))
--   - the ReferenceEndorsementModal textarea maxLength (already 800)
--
-- But edit_endorsement (shipped earlier in 202602040100_edit_endorsement_rpc.sql)
-- was missed and still LEFT()s at 1200. The CHECK now blocks anything > 800
-- so the RPC would simply error if it ever truncated above 800 — but the
-- inconsistency is still a real foot-gun: a programmatic caller hitting the
-- RPC could produce a row that *looks* truncated to 1200 in the function body
-- only to fail the CHECK on commit. Tightening to 800 here removes that
-- ambiguity and keeps every write path on the same number.
--
-- Idempotent: CREATE OR REPLACE FUNCTION leaves the GRANT untouched.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.edit_endorsement(
  p_reference_id UUID,
  p_endorsement TEXT
)
RETURNS public.profile_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_profile UUID := auth.uid();
  updated_row public.profile_references;
BEGIN
  IF current_profile IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to edit an endorsement.';
  END IF;

  UPDATE public.profile_references
     SET endorsement_text = NULLIF(LEFT(btrim(COALESCE(p_endorsement, '')), 800), ''),
         updated_at = timezone('utc', now())
   WHERE id = p_reference_id
     AND reference_id = current_profile
     AND status = 'accepted'
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reference not found or not in accepted state.';
  END IF;

  RETURN updated_row;
END;
$$;
