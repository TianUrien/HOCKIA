-- Rollback: recreate the index dropped by 20261020170000 (identical to
-- events_name_created_idx, as it was before).

CREATE INDEX IF NOT EXISTS events_event_name_created_idx
  ON public.events (event_name, created_at DESC);
