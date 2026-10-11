-- Postgres cannot drop an enum value. Rows using it are removed instead; the
-- value itself stays harmless and unused.
DELETE FROM public.profile_notifications WHERE kind = 'content_removed';
