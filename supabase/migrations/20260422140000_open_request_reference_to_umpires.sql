-- =========================================================================
-- request_reference — open the role gate to umpires
-- =========================================================================
-- The original 202511191200_trusted_references.sql scoped request_reference
-- to players and coaches. The research memo frames the umpire equivalent as
-- "peer assessments" (stage 7 in the trust-and-appointment chain), and the
-- data model fits 1:1 — an umpire asking a coach / fellow umpire / club to
-- vouch for their officiating is the same edge as a player asking a coach.
--
-- Only the requester-role allowlist changes. 5-cap, friendship gate,
-- receiver-side logic, RLS, and denormalized accepted_reference_count all
-- stay untouched — they're already role-agnostic.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.request_reference(
  p_reference_id UUID,
  p_relationship_type TEXT,
  p_request_note TEXT DEFAULT NULL
)
RETURNS public.profile_references
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_profile UUID := auth.uid();
  requester_role TEXT;
  accepted_count INTEGER;
  inserted_row public.profile_references;
BEGIN
  IF current_profile IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to request a reference.';
  END IF;

  IF current_profile = p_reference_id THEN
    RAISE EXCEPTION 'You cannot ask yourself to be a reference.';
  END IF;

  SELECT role INTO requester_role FROM public.profiles WHERE id = current_profile;
  IF requester_role IS NULL THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  -- Widened from ('player', 'coach') to include 'umpire'. Clubs and brands
  -- still can't collect references — their credibility is institutional.
  IF requester_role NOT IN ('player', 'coach', 'umpire') THEN
    RAISE EXCEPTION 'Only players, coaches, and umpires can collect trusted references.';
  END IF;

  SELECT COUNT(*)
    INTO accepted_count
    FROM public.profile_references
   WHERE requester_id = current_profile
     AND status = 'accepted';

  IF accepted_count >= 5 THEN
    RAISE EXCEPTION 'You already have 5 accepted references.';
  END IF;

  PERFORM 1
    FROM public.profile_friendships pf
   WHERE pf.status = 'accepted'
     AND ((pf.user_one = current_profile AND pf.user_two = p_reference_id)
       OR (pf.user_two = current_profile AND pf.user_one = p_reference_id))
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You can only request references from accepted friends.';
  END IF;

  PERFORM 1
    FROM public.profile_references pr
   WHERE pr.requester_id = current_profile
     AND pr.reference_id = p_reference_id
     AND pr.status IN ('pending', 'accepted');

  IF FOUND THEN
    RAISE EXCEPTION 'You already have an active reference with this connection.';
  END IF;

  INSERT INTO public.profile_references (requester_id, reference_id, relationship_type, request_note)
  VALUES (current_profile, p_reference_id, p_relationship_type, NULLIF(btrim(p_request_note), ''))
  RETURNING * INTO inserted_row;

  RETURN inserted_row;
END;
$$;

COMMENT ON FUNCTION public.request_reference IS
  'Send a trusted reference request. Allowed requester roles: player, coach, umpire. Requires accepted friendship with the reference.';

GRANT EXECUTE ON FUNCTION public.request_reference(UUID, TEXT, TEXT) TO authenticated;
