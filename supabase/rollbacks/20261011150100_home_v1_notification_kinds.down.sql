-- ROLLBACK for 20261011150100_home_v1_notification_kinds.sql.
-- NOT a migration (this folder is never pushed). Only for an emergency.
--
-- Postgres cannot drop enum values in place. Unused values are harmless; to
-- stop them being used, roll back 20261011150200 first. Then only clear rows:
DELETE FROM public.profile_notifications WHERE kind::text IN ('congrats_received', 'feed_item_comment_received', 'signing_tagged');
-- then:  supabase migration repair --status reverted 20261011150100 --linked
