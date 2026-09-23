-- Founder ruling 2026-09-23: authenticated users must never hard-delete
-- messages, not even their own — a harassing message could be erased through
-- the API with no trace, and reports / moderation need the record. The app
-- soft-deletes on purpose (delete_message). The policy existed on staging for
-- an hour; on production this is a no-op.
DROP POLICY IF EXISTS "Users can hard-delete their own messages" ON public.messages;
