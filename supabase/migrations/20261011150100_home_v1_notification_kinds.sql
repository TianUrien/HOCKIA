-- Home v1: notification kinds used by the next migration (ADD VALUE must
-- commit before a value is used, so it lives in its own migration).
-- Rollback: enum values cannot be dropped in place; harmless if unused
-- (see supabase/rollbacks/20261011150100_home_v1_notification_kinds.down.sql).
--
--   congrats_received          someone tapped 👏 Congrats on your signing / reference
--   feed_item_comment_received a comment on your reference (comments on feed items)
--   signing_tagged             a club posted your New signing (Figma H15)

ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'congrats_received';
ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'feed_item_comment_received';
ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'signing_tagged';
