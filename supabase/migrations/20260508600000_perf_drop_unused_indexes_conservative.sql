-- =========================================================================
-- Performance — drop unused indexes (conservative cherry-pick)
-- =========================================================================
-- Supabase perf advisor flagged 83 unused indexes. This migration drops
-- the conservative subset — indexes I can confirm are either:
--   (a) on small reference tables where full scans cost nothing
--   (b) speculative future-feature indexes never reached by app code
--   (c) error/audit/admin-reporting indexes that get queried so rarely
--       the planner cost outweighs the index maintenance cost
--   (d) replaced by full-text or trigram alternatives elsewhere
--
-- INTENTIONALLY KEPT (in the advisor's flagged list, but not dropped):
--   - All FK indexes added in Wave 1 (20260508300000) — too soon to call
--     them unused; many serve DELETE-cascade lookups that fire rarely
--   - All queue worker partial indexes (idx_*_unprocessed) — workers
--     run on cron schedules that the snapshot may have missed
--   - Messaging hot-path indexes (idx_conversations_*, idx_messages_*)
--     except idx_messages_metadata_type which is a clear miss
--   - idx_player_full_game_videos_user_public — added with the new
--     feature this session; needs more time before judging
--   - Anything I couldn't immediately confirm was safe (e.g.
--     umpire_appointments_user_id_idx might be a FK index)
--
-- 27 indexes dropped. Storage + write-amplification reduction. If any
-- query starts hot-spotting against a now-missing index, recreate it
-- in a follow-up migration.
-- =========================================================================

-- error_logs (4) — write-heavy, rarely queried
DROP INDEX IF EXISTS public.error_logs_correlation_id_idx;
DROP INDEX IF EXISTS public.error_logs_error_type_idx;
DROP INDEX IF EXISTS public.error_logs_severity_idx;
DROP INDEX IF EXISTS public.error_logs_source_idx;

-- countries (3) — small reference table, full scan fine
DROP INDEX IF EXISTS public.idx_countries_name;
DROP INDEX IF EXISTS public.idx_countries_name_trgm;
DROP INDEX IF EXISTS public.idx_countries_nationality;

-- admin_audit_logs (2) — admin-only, rare scans
DROP INDEX IF EXISTS public.idx_admin_audit_logs_action;
DROP INDEX IF EXISTS public.idx_admin_audit_logs_target;

-- profiles speculative indexes (8) — added for features not yet
-- exercised in production (or never wired to a query path)
DROP INDEX IF EXISTS public.idx_profiles_open_to_coach;
DROP INDEX IF EXISTS public.idx_profiles_has_social_links;
DROP INDEX IF EXISTS public.idx_profiles_playing_category;
DROP INDEX IF EXISTS public.idx_profiles_coaching_categories;
DROP INDEX IF EXISTS public.idx_profiles_umpiring_categories;
DROP INDEX IF EXISTS public.idx_profiles_ai_base_city;
DROP INDEX IF EXISTS public.profiles_is_verified_idx;
DROP INDEX IF EXISTS public.profiles_last_officiated_at_idx;

-- world directory small-reference indexes (3) — tables small enough
-- that the planner prefers seq scans
DROP INDEX IF EXISTS public.idx_world_leagues_tier;
DROP INDEX IF EXISTS public.idx_world_provinces_slug;
DROP INDEX IF EXISTS public.idx_world_clubs_name_search;

-- brands.idx_brands_search — replaced by full-text search vector
DROP INDEX IF EXISTS public.idx_brands_search;

-- user_devices.idx_user_devices_platform — analytics-only, rare read
DROP INDEX IF EXISTS public.idx_user_devices_platform;

-- user_blocks.idx_user_blocks_blocked — admin moderation, rare read
DROP INDEX IF EXISTS public.idx_user_blocks_blocked;

-- push_subscriptions.idx_push_subscriptions_fcm_token — used by
-- cleanup-on-401, fires rarely; planner can scan when needed
DROP INDEX IF EXISTS public.idx_push_subscriptions_fcm_token;

-- user_pulse_items.idx_user_pulse_type_created — analytics-only
DROP INDEX IF EXISTS public.idx_user_pulse_type_created;

-- discovery_events.discovery_events_fallback_used_idx — append-only
-- analytics table, indexes barely beneficial vs write cost
DROP INDEX IF EXISTS public.discovery_events_fallback_used_idx;

-- events.events_error_code_idx — error tracking on events table,
-- rarely queried
DROP INDEX IF EXISTS public.events_error_code_idx;

-- user_engagement_heartbeats.idx_engagement_heartbeats_created —
-- analytics aggregate, scanned in batch not point-queried
DROP INDEX IF EXISTS public.idx_engagement_heartbeats_created;
