-- Rollback for 20261011160000_opportunity_deadline_validation.sql.
-- The 4 corrected rows keep their corrected dates (restoring a typo is never wanted).
DROP TRIGGER IF EXISTS trg_guard_opportunity_deadline ON public.opportunities;
DROP FUNCTION IF EXISTS public.guard_opportunity_deadline();
ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_application_deadline_range;
