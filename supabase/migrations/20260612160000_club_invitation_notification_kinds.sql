-- ============================================================================
-- Club membership invitations — notification kinds
-- ============================================================================
-- Standalone migration: ALTER TYPE ... ADD VALUE must be committed in its own
-- transaction before the value can be referenced (by the invite RPCs in
-- 20260612160100_club_membership.sql). Same split the repo already uses for
-- e.g. ambassador_request_received and user_post_comment_received.

ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'club_invitation_received';
ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'club_invitation_accepted';
