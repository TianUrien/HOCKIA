-- =========================================================================
-- Open roles follow the same publisher rules as closed roles
-- =========================================================================
-- Closed roles (20260928260000_closed_roles_readable.sql) are hidden when the
-- publisher is hidden (blocked / frozen) or when the viewer and the publisher
-- have blocked each other. Open roles now follow the same rules:
--
--   * Everyone (guests included): an open role from a hidden publisher is not
--     shown. The public_opportunities view already filtered this; the table
--     read now matches it.
--   * Signed-in viewers: an open role is not shown when the viewer and the
--     publisher have blocked each other (either direction). Guests have no
--     identity, so only the first rule applies to them.
--   * Unchanged: publishers still read all their own roles (their ALL policy),
--     applicants keep reading the roles they applied to (their own policy),
--     admins keep reading everything, service-role readers are not affected.
--   * The check runs in a SECURITY DEFINER helper so it sees the publisher row
--     regardless of the viewer's own profiles visibility.
--   * Explicit GRANTs (default ACLs no longer cover new functions): EXECUTE for
--     anon + authenticated (the policy runs as the caller) and service_role.
-- Rollback: supabase/rollbacks/20260929100000_open_roles_hidden_club_fence.down.sql
-- =========================================================================

CREATE OR REPLACE FUNCTION public.viewer_can_view_open_opportunity(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = p_club_id
        AND public.profile_is_hidden(p.is_blocked, p.frozen_minor_at)
    )
    AND (
      auth.uid() IS NULL
      OR NOT public.is_blocked_pair(auth.uid(), p_club_id)
    );
$$;

REVOKE ALL ON FUNCTION public.viewer_can_view_open_opportunity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_can_view_open_opportunity(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.viewer_can_view_open_opportunity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.viewer_can_view_open_opportunity(uuid) TO service_role;

DROP POLICY IF EXISTS "Public can view open opportunities" ON public.opportunities;
CREATE POLICY "Public can view open opportunities"
  ON public.opportunities
  FOR SELECT
  TO public
  USING (
    status = 'open'::public.opportunity_status
    AND public.viewer_can_view_open_opportunity(club_id)
  );
