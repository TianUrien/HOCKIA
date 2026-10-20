-- public.events carried two identical indexes on (event_name, created_at DESC):
-- events_event_name_created_idx (202512241000_admin_analytics_schema) and
-- events_name_created_idx (20260725100000_analytics_foundation). Supabase's
-- performance advisor flags the pair (duplicate_index, 2026-10-20); every
-- insert into events maintained both. The older name goes; the planner keeps
-- the same index shape through events_name_created_idx.
-- Rollback: supabase/rollbacks/20261020170000_drop_duplicate_events_index.down.sql

DROP INDEX IF EXISTS public.events_event_name_created_idx;
