-- ─────────────────────────────────────────────────────────────────────
-- Fix respond_reference: 42804 datatype_mismatch on accept
-- ─────────────────────────────────────────────────────────────────────
-- Regression introduced by 20260430030000_references_bug_bundle.sql:
-- the bug-bundle re-wrote respond_reference and lost the explicit
-- ::profile_reference_status casts that the earlier
-- 202511201245_fix_reference_acceptance.sql migration had added.
--
-- Postgres 14+ no longer implicitly casts text → user-defined enum in
-- column assignments. The naked literals 'accepted' / 'declined' in
-- the SET clause raise:
--   SQLSTATE 42804 — column "status" is of type
--   profile_reference_status but expression is of type text
-- which surfaces in the UI as "Unable to update reference. Please try
-- again." every time a recipient hits Accept or Decline.
--
-- This migration re-creates respond_reference with explicit casts. It
-- keeps every behavioural addition from the bug bundle:
--   - friendship re-check on the accept path
--   - decline + revoke remain accessible even after un-friending
--   - race-safe NOT FOUND raise after the UPDATE
-- — only the cast bug is fixed.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.respond_reference(
  p_reference_id UUID,
  p_accept BOOLEAN,
  p_endorsement TEXT DEFAULT NULL
)
RETURNS public.profile_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_profile UUID := auth.uid();
  pending_row     public.profile_references;
  updated_row     public.profile_references;
  is_friend       BOOLEAN;
BEGIN
  IF current_profile IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to respond to a reference request.';
  END IF;

  -- Look up the pending row first so the friendship re-check can use the
  -- requester_id. RAISE before mutating anything.
  SELECT *
    INTO pending_row
    FROM public.profile_references
   WHERE id = p_reference_id
     AND reference_id = current_profile
     AND status = 'pending'::public.profile_reference_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reference request not found or already handled.';
  END IF;

  -- Phase 4 fix #4a: only the accept path requires an active friendship.
  -- Decline + revoke remain accessible even if the requester unfriended
  -- the reference, so the recipient can always clear their inbox.
  IF p_accept THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.profile_friendships pf
       WHERE pf.status = 'accepted'
         AND ((pf.user_one = pending_row.requester_id AND pf.user_two = current_profile)
           OR (pf.user_two = pending_row.requester_id AND pf.user_one = current_profile))
    ) INTO is_friend;

    IF NOT is_friend THEN
      RAISE EXCEPTION 'Cannot accept this reference — the requester is no longer in your friends list.';
    END IF;
  END IF;

  UPDATE public.profile_references
     SET status = CASE
                    WHEN p_accept THEN 'accepted'::public.profile_reference_status
                    ELSE 'declined'::public.profile_reference_status
                  END,
         endorsement_text = CASE
           WHEN p_accept THEN NULLIF(LEFT(btrim(COALESCE(p_endorsement, '')), 800), '')
           ELSE endorsement_text
         END,
         responded_at = timezone('utc', now())
   WHERE id = p_reference_id
     AND reference_id = current_profile
     AND status = 'pending'::public.profile_reference_status
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    -- Race: someone else (or another connection) handled it between the
    -- SELECT above and this UPDATE. Surface the same friendly error as
    -- the initial NOT FOUND.
    RAISE EXCEPTION 'Reference request not found or already handled.';
  END IF;

  RETURN updated_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.respond_reference(UUID, BOOLEAN, TEXT) TO authenticated;

COMMENT ON FUNCTION public.respond_reference IS
  'Accepts or declines a pending reference request. Accept path re-checks active friendship; decline path does not. Status assignments are explicitly cast to profile_reference_status (Postgres 14+ requires this for user-defined enums).';
