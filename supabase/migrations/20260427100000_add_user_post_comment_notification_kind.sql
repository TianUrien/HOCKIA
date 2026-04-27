-- ============================================================================
-- Add 'user_post_comment_received' to profile_notification_kind
-- ============================================================================
-- Standalone migration because ALTER TYPE ... ADD VALUE cannot run in a
-- transaction block. The trigger that uses this enum value is created in
-- a separate follow-up migration (20260427100001) so it can reference the
-- new label after this migration commits.

ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'user_post_comment_received';
