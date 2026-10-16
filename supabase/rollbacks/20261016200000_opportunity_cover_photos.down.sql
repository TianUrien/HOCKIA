-- Rollback for 20261016200000_opportunity_cover_photos.sql.
-- Restores the takedown v2 function bodies as read from staging on 2026-10-16
-- (20261011150700), the previous orphan sweep (20260906090000), the previous
-- CHECK lists and drops the role-covers policies. The bucket and its objects
-- are left in place (dropping a bucket with objects fails; the sweep no longer
-- touches it). Rows with content_type 'opportunity' must be gone first or the
-- CHECKs fail — DELETE them only if the feature is being abandoned.
DROP POLICY IF EXISTS "Public role cover access" ON storage.objects;
DROP POLICY IF EXISTS "Publishers upload role covers" ON storage.objects;
DROP POLICY IF EXISTS "Publishers update role covers" ON storage.objects;
DROP POLICY IF EXISTS "Publishers delete role covers" ON storage.objects;

ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_content_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_content_type_check
  CHECK (content_type = ANY (ARRAY['user', 'post', 'comment', 'profile_comment', 'feed_item', 'feed_item_comment', 'video']));
ALTER TABLE public.content_takedowns DROP CONSTRAINT IF EXISTS content_takedowns_content_type_check;
ALTER TABLE public.content_takedowns ADD CONSTRAINT content_takedowns_content_type_check
  CHECK (content_type IN ('post', 'comment', 'profile_comment', 'feed_item', 'feed_item_comment', 'video'));

-- Function bodies: re-apply the previous migrations' definitions.
-- admin_takedown_content / admin_restore_content / admin_content_preview → 20261011150700_admin_takedown_v2.sql
-- enqueue_orphaned_storage_objects → 20260906090000_storage_cleanup_grace_and_stale_queues.sql
-- (Each is a plain CREATE OR REPLACE; run those sections of the files above.)
