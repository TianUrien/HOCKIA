-- MEDIUM fix from Tian's prod QA (2026-07-12), cross-confirmed on both
-- sides: when a club CLOSES an opportunity, the applicant's Pulse
-- "Your applications" row lost its title (joined SELECT blocked) and its
-- detail link died ("Opportunity Not Found") — the base SELECT policy is
-- USING (status = 'open'), so a role disappears from the very people who
-- applied to it the moment it closes. (Live case: CASI's "Arquera"
-- e25b1e75 → Valentina's dead row.)
--
-- Fix: applicants may read opportunities they applied to, regardless of
-- status. Fenced per the standing hidden-profile invariant: if the
-- publishing club is hidden (banned / frozen minor), the row stays hidden
-- even from its applicants — the client renders those as "no longer
-- available". auth.uid() wrapped in a scalar subquery per the initplan
-- perf convention (20260508500000).
CREATE POLICY "Applicants can view opportunities they applied to"
  ON public.opportunities
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.opportunity_applications a
      WHERE a.opportunity_id = opportunities.id
        AND a.applicant_id = (SELECT auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = opportunities.club_id
        AND public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    )
  );
