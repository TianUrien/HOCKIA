-- ROLLBACK for 20260929100000_open_roles_hidden_club_fence.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- No data is touched: it restores the previous open-roles read policy and
-- removes its helper.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20260929100000 --linked

DROP POLICY IF EXISTS "Public can view open opportunities" ON public.opportunities;
CREATE POLICY "Public can view open opportunities"
  ON public.opportunities
  FOR SELECT
  TO public
  USING (status = 'open'::public.opportunity_status);

DROP FUNCTION IF EXISTS public.viewer_can_view_open_opportunity(uuid);
