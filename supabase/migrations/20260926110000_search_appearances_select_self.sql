-- Search-appearance logging has written almost nothing since early September (1 row in 30 days
-- on production; 403 "new row violates row-level security policy" in the logs).
--
-- The client upserts with ON CONFLICT (profile_id, viewer_id, hour_bucket) DO NOTHING, which is
-- what dedupes a viewer to one row per profile per hour. Postgres evaluates the table's SELECT
-- policies while it checks the conflict, and this table only had an admin SELECT policy, so every
-- upsert from a member was rejected. A plain INSERT of the same row passes (verified on prod,
-- rolled back).
--
-- home_module_impressions, cloned from this table, works because it also has a self SELECT
-- policy. Same fix here: a viewer may read the rows they logged themselves (their own activity:
-- which profiles appeared in their own searches). Profile owners still only get aggregates via
-- get_profile_search_appearances, and never learn who the viewer was.

DROP POLICY IF EXISTS profile_search_appearances_select_self ON public.profile_search_appearances;
CREATE POLICY profile_search_appearances_select_self
  ON public.profile_search_appearances
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = viewer_id);
