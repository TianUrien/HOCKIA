-- Rollback: hide withdrawn applications from publishers again (as in 20260707170000).

DROP POLICY IF EXISTS "Publishers can view applications to their opportunities" ON public.opportunity_applications;
CREATE POLICY "Publishers can view applications to their opportunities" ON public.opportunity_applications
  FOR SELECT TO authenticated
  USING (
    status <> 'withdrawn'
    AND EXISTS (
      SELECT 1 FROM public.opportunities o
      WHERE o.id = opportunity_applications.opportunity_id
        AND o.club_id = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles ap
      WHERE ap.id = opportunity_applications.applicant_id
        AND NOT public.profile_is_hidden(ap.is_blocked, ap.frozen_minor_at)
    )
  );
