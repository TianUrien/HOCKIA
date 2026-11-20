-- Restate edit_endorsement so staging matches production and the repo.
--
-- Found on 2026-11-20 by comparing every public function between the two
-- databases. Both have the same 695 migrations recorded, and after removing
-- comments and whitespace 706 of 707 functions are identical. The one that
-- differs is this: staging still truncates an endorsement at 1200 characters,
-- although 20260504000000_edit_endorsement_align_char_cap.sql (recorded as
-- applied there) sets 800. Production has 800, as the repo says.
--
-- Effect of the drift on staging: none for members (the edit box stops at
-- 800 and the table CHECK refuses anything longer); a direct RPC call with
-- 801 to 1200 characters failed the CHECK instead of being cut at 800.
--
-- This is the body of 20260504000000, unchanged. On production it replaces
-- the function with an identical one. Same signature and grants.
--
-- Rollback: supabase/rollbacks/20261120100000_restate_edit_endorsement.down.sql

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
