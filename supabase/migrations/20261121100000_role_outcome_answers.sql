-- Role outcome answers: what the recruiter says happened to a role.
--
-- Founder ruling 2026-11-21 (docs/product/proposals/recruiter-satisfaction.md,
-- phase 2). Most roles close by automatic expiry and nobody is asked whether
-- the place was filled, so "filled through Hockia" is unknown for almost
-- every closed role. The recruiter (a club, or a coach who recruits) now
-- answers once per role, when closing it or after it expired:
--   filled_hockia     filled with someone from Hockia (optionally: which applicant)
--   filled_elsewhere  filled with someone else
--   still_looking     not filled, still looking
--   stopped_looking   not filled, no longer looking
--   skipped           the recruiter was asked and did not answer
--
-- dismiss_count: how many times the recruiter closed the question for a role
-- that expired. The app asks once more 14 days after the first close and then
-- never again (founder ruling 2026-11-21), so it is 0, 1 or 2.
--
-- The answer is PRIVATE measurement data (founder ruling, same day): only the
-- recruiter who gave it and platform admins can read it. It publishes nothing,
-- notifies nobody, and does not touch opportunities.filled_via_hockia, which
-- stays server-controlled by the signing flow.
--
-- New table only: no existing column, function or grant changes, so installed
-- app builds are unaffected.
--
-- Rollback: supabase/rollbacks/20261121100000_role_outcome_answers.down.sql

CREATE TABLE IF NOT EXISTS public.role_outcome_answers (
  opportunity_id uuid PRIMARY KEY REFERENCES public.opportunities(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('filled_hockia', 'filled_elsewhere', 'still_looking', 'stopped_looking', 'skipped')),
  hired_application_id uuid REFERENCES public.opportunity_applications(id) ON DELETE SET NULL,
  asked_via text NOT NULL CHECK (asked_via IN ('close', 'expiry')),
  answered_at timestamptz NOT NULL DEFAULT now(),
  dismiss_count smallint NOT NULL DEFAULT 0 CHECK (dismiss_count BETWEEN 0 AND 2),
  CONSTRAINT role_outcome_hired_only_when_hockia CHECK (hired_application_id IS NULL OR outcome = 'filled_hockia')
);
CREATE INDEX IF NOT EXISTS role_outcome_answers_recruiter_idx ON public.role_outcome_answers (recruiter_id);

ALTER TABLE public.role_outcome_answers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.role_outcome_answers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.role_outcome_answers TO authenticated;
GRANT ALL ON TABLE public.role_outcome_answers TO service_role;

-- The recruiter reads their own answers; a platform admin reads all (aggregate reports).
DROP POLICY IF EXISTS role_outcome_answers_select ON public.role_outcome_answers;
CREATE POLICY role_outcome_answers_select ON public.role_outcome_answers
  FOR SELECT TO authenticated
  USING (recruiter_id = (SELECT auth.uid()) OR public.is_platform_admin());

-- Only the role's own publisher answers, and only about an applicant of that role.
DROP POLICY IF EXISTS role_outcome_answers_insert ON public.role_outcome_answers;
CREATE POLICY role_outcome_answers_insert ON public.role_outcome_answers
  FOR INSERT TO authenticated
  WITH CHECK (
    recruiter_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opportunity_id AND o.club_id = (SELECT auth.uid()))
    AND (hired_application_id IS NULL OR EXISTS (
      SELECT 1 FROM public.opportunity_applications a WHERE a.id = hired_application_id AND a.opportunity_id = role_outcome_answers.opportunity_id))
  );

DROP POLICY IF EXISTS role_outcome_answers_update ON public.role_outcome_answers;
CREATE POLICY role_outcome_answers_update ON public.role_outcome_answers
  FOR UPDATE TO authenticated
  USING (recruiter_id = (SELECT auth.uid()))
  WITH CHECK (
    recruiter_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opportunity_id AND o.club_id = (SELECT auth.uid()))
    AND (hired_application_id IS NULL OR EXISTS (
      SELECT 1 FROM public.opportunity_applications a WHERE a.id = hired_application_id AND a.opportunity_id = role_outcome_answers.opportunity_id))
  );

COMMENT ON TABLE public.role_outcome_answers IS
  'What the recruiter says happened to a role (filled through Hockia, elsewhere, still looking, stopped). Private measurement data: recruiter and admins only. 20261121100000.';
