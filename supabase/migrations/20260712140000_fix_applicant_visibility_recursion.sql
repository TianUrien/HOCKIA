-- HOTFIX for 20260712130000 (staging-only breakage, never reached prod):
-- the applicant-visibility policy on opportunities referenced
-- opportunity_applications, whose publisher policy references opportunities
-- back → 42P17 "infinite recursion detected in policy" — every
-- opportunity_applications read 500'd.
--
-- Standard fix: evaluate the cross-table checks in a SECURITY DEFINER
-- helper (bypasses RLS inside → no recursion). This also fixes a silent
-- no-op in the original: the hidden-club NOT EXISTS ran under the caller's
-- RLS, which already hides hidden profiles — so it could never match. The
-- definer helper sees the real rows, and the fence actually fences.
CREATE OR REPLACE FUNCTION public.applicant_can_view_opportunity(
  p_opportunity_id uuid,
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.opportunity_applications a
    WHERE a.opportunity_id = p_opportunity_id
      AND a.applicant_id = auth.uid()
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_club_id
      AND public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.applicant_can_view_opportunity(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.applicant_can_view_opportunity(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Applicants can view opportunities they applied to" ON public.opportunities;
CREATE POLICY "Applicants can view opportunities they applied to"
  ON public.opportunities
  FOR SELECT TO authenticated
  USING (public.applicant_can_view_opportunity(id, club_id));

-- Self-check: the recursive shape must be gone (policy now delegates to the
-- definer fn; a plain applications read must not recurse).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'opportunities'
      AND policyname = 'Applicants can view opportunities they applied to'
      AND qual NOT LIKE '%applicant_can_view_opportunity%'
  ) THEN
    RAISE EXCEPTION 'RECURSION-FIX-CHECK: policy does not delegate to the definer helper';
  END IF;
END $$;
