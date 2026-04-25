-- Phase 1: Discovery AI reliability & observability
-- Extends discovery_events with token usage, retry/fallback signals, and
-- prompt versioning. Columns are nullable or defaulted so the table stays
-- compatible with edge function versions that don't yet write them.

ALTER TABLE public.discovery_events
  ADD COLUMN IF NOT EXISTS prompt_tokens     INT,
  ADD COLUMN IF NOT EXISTS completion_tokens INT,
  ADD COLUMN IF NOT EXISTS cached_tokens     INT,
  ADD COLUMN IF NOT EXISTS prompt_version    TEXT,
  ADD COLUMN IF NOT EXISTS fallback_used     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retry_count       SMALLINT NOT NULL DEFAULT 0;

-- Partial index so "how often did we fall back?" stays fast as the table grows.
CREATE INDEX IF NOT EXISTS discovery_events_fallback_used_idx
  ON public.discovery_events (created_at DESC)
  WHERE fallback_used = true;
