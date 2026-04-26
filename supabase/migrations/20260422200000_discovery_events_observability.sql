-- Captured from prod's supabase_migrations.schema_migrations on 2026-04-25.
-- This is the version that landed on prod via dashboard. The earlier
-- repo file at 20260424120000 was a duplicate (same content under
-- a different timestamp) and was deleted in commit ffc2340.

ALTER TABLE public.discovery_events
  ADD COLUMN IF NOT EXISTS prompt_tokens     INT,
  ADD COLUMN IF NOT EXISTS completion_tokens INT,
  ADD COLUMN IF NOT EXISTS cached_tokens     INT,
  ADD COLUMN IF NOT EXISTS prompt_version    TEXT,
  ADD COLUMN IF NOT EXISTS fallback_used     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retry_count       SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS discovery_events_fallback_used_idx
  ON public.discovery_events (created_at DESC)
  WHERE fallback_used = true;
