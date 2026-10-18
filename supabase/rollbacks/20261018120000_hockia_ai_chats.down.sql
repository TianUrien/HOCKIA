-- Rollback for 20261018120000_hockia_ai_chats.sql: removes chat history
-- (all stored chats are lost; the feature is additive, nothing else reads it).
DO $$
BEGIN
  PERFORM cron.unschedule('prune_hockia_ai_chats_daily');
EXCEPTION WHEN others THEN NULL;
END $$;
DROP FUNCTION IF EXISTS public.prune_hockia_ai_chats(integer);
DROP TABLE IF EXISTS public.hockia_ai_chats;
DROP FUNCTION IF EXISTS public.hockia_ai_chats_touch();
