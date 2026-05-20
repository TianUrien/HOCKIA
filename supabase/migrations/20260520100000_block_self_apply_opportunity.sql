-- ============================================================================
-- Migration: Block self-apply on own opportunities
-- ============================================================================
-- Problem: a publisher (club, or coach in recruiter mode) could insert an
-- application row where applicant_id = opportunity.club_id, because the
-- existing "Applicants can create applications" policy only validates that
-- the applicant role matches the opportunity type and that the opportunity
-- is open. The client now hides the Apply CTA on the publisher's own
-- listing, but defence-in-depth means the server should reject the row
-- even if a future client bypasses the UI (deep link, direct API call,
-- forged form post).
--
-- Fix: extend the WITH CHECK of "Applicants can create applications" with
-- the additional constraint `auth.uid() <> o.club_id`. Preserves every
-- existing rule (own user as applicant, role match, opportunity open).
-- ============================================================================

DROP POLICY IF EXISTS "Applicants can create applications" ON public.opportunity_applications;

CREATE POLICY "Applicants can create applications"
  ON public.opportunity_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User must be the applicant
    auth.uid() = applicant_id
    -- AND the opportunity must be open, role must match, and the
    -- applicant must NOT be the publisher.
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.opportunities o ON o.id = opportunity_id
      WHERE p.id = auth.uid()
      -- Opportunity must be open for applications
      AND o.status = 'open'
      -- Self-apply guard — the publisher must not apply to their own listing.
      AND o.club_id <> auth.uid()
      AND (
        -- Player applying to player opportunity
        (p.role = 'player' AND o.opportunity_type = 'player')
        OR
        -- Coach applying to coach opportunity
        (p.role = 'coach' AND o.opportunity_type = 'coach')
      )
    )
  );

COMMENT ON POLICY "Applicants can create applications" ON public.opportunity_applications IS
  'Users can only apply to OPEN opportunities where their role matches the opportunity type AND they are not the publisher. Prevents self-apply (publisher = applicant), applications to closed/draft opportunities, and role mismatches.';
