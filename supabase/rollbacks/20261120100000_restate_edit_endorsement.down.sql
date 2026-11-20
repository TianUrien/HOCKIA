-- Rollback for 20261120100000_restate_edit_endorsement.sql.
--
-- The migration restates the function that production already had (cap at
-- 800). The state before it on production is the same function, so this file
-- restores exactly that. It does not bring back the 1200 cap staging had by
-- mistake: that value contradicts the table CHECK.

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
