-- ROLLBACK for 20260929200000_shortlist_per_role_unique.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:        supabase migration repair --status reverted 20260929200000 --linked
--
-- Restoring UNIQUE (owner_id, saved_profile_id) fails while any player sits on
-- two lists of the same owner. The first statement keeps each owner's OLDEST
-- row per player and deletes the others (their notes/statuses are lost), so
-- review what it will delete first:
--   SELECT owner_id, saved_profile_id, count(*) FROM public.saved_profiles
--    GROUP BY 1, 2 HAVING count(*) > 1;

DELETE FROM public.saved_profiles sp
 USING public.saved_profiles keep
 WHERE keep.owner_id = sp.owner_id
   AND keep.saved_profile_id = sp.saved_profile_id
   AND (keep.created_at, keep.id) < (sp.created_at, sp.id);

DROP TRIGGER IF EXISTS saved_profiles_list_owner_guard ON public.saved_profiles;
DROP FUNCTION IF EXISTS public.saved_profiles_list_owner_guard();
DROP INDEX IF EXISTS public.saved_profiles_owner_player_idx;
DROP INDEX IF EXISTS public.saved_profiles_owner_player_no_list;

ALTER TABLE public.saved_profiles
  ADD CONSTRAINT saved_profiles_unique_pair UNIQUE (owner_id, saved_profile_id);
