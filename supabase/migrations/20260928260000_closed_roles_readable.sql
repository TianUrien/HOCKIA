-- =========================================================================
-- Closed roles readable by signed-in members
-- =========================================================================
-- Founder ruling 2026-09-26: a closed role opens as a closed page ("This role
-- is closed" + "See open roles") for any signed-in member, instead of
-- "Opportunity Not Found". Applicants already read the roles they applied to;
-- this adds the same read for everyone signed in, for CLOSED roles only.
--
--   * status = 'closed' only. Drafts stay owner-only (the publisher's ALL
--     policy); open roles keep their existing policy untouched.
--   * Signed-in only (role authenticated). Guests keep seeing open roles only.
--   * Same publisher rule as the applicant read (applicant_can_view_opportunity):
--     a hidden publisher (blocked / frozen) hides its closed roles too. Also
--     hidden when the viewer and the publisher have blocked each other.
--     The check runs in a SECURITY DEFINER helper so it sees the publisher
--     row regardless of the viewer's own profiles visibility.
--   * Explicit GRANTs (default ACLs no longer cover new functions): EXECUTE
--     for authenticated only (policies run as the caller).
-- Rollback: supabase/rollbacks/20260928260000_closed_roles_readable.down.sql
-- =========================================================================

CREATE OR REPLACE FUNCTION public.member_can_view_closed_opportunity(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = p_club_id
        AND public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    )
    AND NOT public.is_blocked_pair(auth.uid(), p_club_id);
$$;

REVOKE ALL ON FUNCTION public.member_can_view_closed_opportunity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.member_can_view_closed_opportunity(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.member_can_view_closed_opportunity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.member_can_view_closed_opportunity(uuid) TO service_role;

DROP POLICY IF EXISTS "Members can view closed opportunities" ON public.opportunities;
CREATE POLICY "Members can view closed opportunities"
  ON public.opportunities
  FOR SELECT
  TO authenticated
  USING (
    status = 'closed'::public.opportunity_status
    AND public.member_can_view_closed_opportunity(club_id)
  );
