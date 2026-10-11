-- Admin takedown (Figma A1 93:1013): the optional neutral notice to the author.
-- Own migration: a new enum value can't be used in the transaction that adds it.
ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'content_removed';
