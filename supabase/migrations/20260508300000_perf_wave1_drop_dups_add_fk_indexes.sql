-- =========================================================================
-- Performance Wave 1 — drop 5 duplicate indexes + add 20 missing FK indexes
-- =========================================================================
-- From the production-readiness audit's performance batch. Pure additive
-- index work; zero behavioral changes, zero RLS changes. Safe to apply
-- without rollout coordination.
--
-- The bigger items (103 auth.uid() RLS rewrites, 144 multi-permissive
-- policy merges, 70 unused-index drops) are intentionally NOT in this
-- migration — they need careful per-policy / per-index review and would
-- make this migration too risky to revert quickly.
--
-- =========================================================================
-- Part 1 — drop 5 duplicate indexes
-- =========================================================================
-- Each pair below was confirmed to have identical pg_get_indexdef output;
-- one of the two is a no-op. Where one of the pair backs a constraint we
-- keep the constraint-backing one and drop the standalone duplicate.
--
-- opportunity_applications & profile_friendships have two unique
-- constraints each with the same definition — pre-rename leftovers from
-- the vacancies → opportunities terminology shift. Drop the older
-- "vacancy_*" constraint to remove its backing index; the canonical
-- "_key" / "_unique" constraint stays.
-- =========================================================================

DROP INDEX IF EXISTS public.idx_home_feed_items_created_at;
DROP INDEX IF EXISTS public.profile_friendships_pair_key_idx;
DROP INDEX IF EXISTS public.idx_profile_notifications_recipient_unread;
DROP INDEX IF EXISTS public.idx_user_posts_feed;

ALTER TABLE public.opportunity_applications
  DROP CONSTRAINT IF EXISTS vacancy_applications_unique;

-- =========================================================================
-- Part 2 — add 20 missing FK indexes
-- =========================================================================
-- All FK columns flagged by the perf advisor as unindexed. Indexing FK
-- columns matters most for: (a) DELETE-cascade lookups on the parent,
-- and (b) JOINs from child to parent in app queries. Both are seq scans
-- without these indexes. Naming convention: idx_<table>_<column>.
--
-- IF NOT EXISTS guards keep the migration idempotent if any of these
-- get added by a later migration before this one runs in another env.
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_country_text_aliases_country_id
  ON public.country_text_aliases (country_id);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_created_by
  ON public.email_campaigns (created_by);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_template_id
  ON public.email_campaigns (template_id);

CREATE INDEX IF NOT EXISTS idx_email_template_versions_created_by
  ON public.email_template_versions (created_by);

CREATE INDEX IF NOT EXISTS idx_home_feed_items_author_profile_id
  ON public.home_feed_items (author_profile_id);

CREATE INDEX IF NOT EXISTS idx_investor_share_tokens_created_by
  ON public.investor_share_tokens (created_by);

CREATE INDEX IF NOT EXISTS idx_message_digest_queue_recipient_id
  ON public.message_digest_queue (recipient_id);

CREATE INDEX IF NOT EXISTS idx_outreach_contacts_imported_by
  ON public.outreach_contacts (imported_by);

CREATE INDEX IF NOT EXISTS idx_post_likes_user_id
  ON public.post_likes (user_id);

CREATE INDEX IF NOT EXISTS idx_profile_friendships_user_one
  ON public.profile_friendships (user_one);

CREATE INDEX IF NOT EXISTS idx_profile_friendships_user_two
  ON public.profile_friendships (user_two);

CREATE INDEX IF NOT EXISTS idx_profile_references_revoked_by
  ON public.profile_references (revoked_by);

CREATE INDEX IF NOT EXISTS idx_profile_search_appearances_viewer_id
  ON public.profile_search_appearances (viewer_id);

CREATE INDEX IF NOT EXISTS idx_profile_view_email_queue_recipient_id
  ON public.profile_view_email_queue (recipient_id);

CREATE INDEX IF NOT EXISTS idx_profiles_blocked_by
  ON public.profiles (blocked_by);

CREATE INDEX IF NOT EXISTS idx_profiles_verified_by
  ON public.profiles (verified_by);

CREATE INDEX IF NOT EXISTS idx_reference_reminder_queue_suggested_friend_id
  ON public.reference_reminder_queue (suggested_friend_id);

CREATE INDEX IF NOT EXISTS idx_user_reports_reviewed_by
  ON public.user_reports (reviewed_by);

CREATE INDEX IF NOT EXISTS idx_world_clubs_men_league_id
  ON public.world_clubs (men_league_id);

CREATE INDEX IF NOT EXISTS idx_world_clubs_women_league_id
  ON public.world_clubs (women_league_id);
