-- D4 · founder ruling 2026-09-25 / 2026-10-02: clubs MUST see withdrawn
-- applications to their own roles (read-only, grey "Withdrawn" under the
-- Closed chip). Until now the publisher read policy excluded withdrawn rows
-- (20260707170000), so a withdrawn applicant vanished from the club's list.
--
-- Change: the publisher SELECT policy no longer filters on status. Everything
-- else is as before: own roles only, hidden applicants stay hidden, and a
-- withdrawn row still cannot be changed (guard trigger from 20260926100000:
-- "A withdrawn application cannot be changed").
-- Rollback: supabase/rollbacks/20261002200000_publishers_see_withdrawn_applications.down.sql

DROP POLICY IF EXISTS "Publishers can view applications to their opportunities" ON public.opportunity_applications;
CREATE POLICY "Publishers can view applications to their opportunities" ON public.opportunity_applications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
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
