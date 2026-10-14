-- Chat realtime: the client subscribes to postgres_changes on public.messages
-- (INSERT and UPDATE, filtered by conversation_id — hooks/useChat.ts) and on
-- public.conversations (per participant — pages/MessagesPage.tsx). Neither
-- table was in the supabase_realtime publication, so Realtime answered
-- "Unable to subscribe to changes with given parameters" and an open chat only
-- learned about the other side's reply on reload (found 2026-10-14, same on
-- staging and production).
--
-- RLS stays the gate: Realtime evaluates each subscriber's SELECT policies
-- before delivering a row, and both tables keep row security on with their
-- participant-only policies. No new objects, so no GRANTs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations';
  END IF;
END $$;
