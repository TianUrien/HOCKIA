-- 004_indexes_views.sql
-- Performance indexes and analytical views for HOCKIA Supabase project
-- Run via: supabase db execute --file supabase_setup/004_indexes_views.sql

SET search_path = public;

-- ============================================================================
-- PROFILES INDEXES
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_unique
  ON public.profiles (LOWER(username))
  WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_username
  ON public.profiles (username)
  WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON public.profiles (role);

CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_completed
  ON public.profiles (onboarding_completed);

CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_created
  ON public.profiles (created_at DESC)
  WHERE onboarding_completed = TRUE;

CREATE INDEX IF NOT EXISTS idx_profiles_role_created
  ON public.profiles (role, created_at DESC);

-- ============================================================================
-- VACANCIES INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_vacancies_club_id
  ON public.vacancies (club_id);

CREATE INDEX IF NOT EXISTS idx_vacancies_club_status
  ON public.vacancies (club_id, status);

CREATE INDEX IF NOT EXISTS idx_vacancies_status_position_club
  ON public.vacancies (status, position, club_id);

CREATE INDEX IF NOT EXISTS idx_vacancies_open
  ON public.vacancies (club_id, created_at DESC, position)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_vacancies_published
  ON public.vacancies (application_deadline DESC NULLS LAST)
  WHERE status = 'open' AND published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vacancies_club_status_updated
  ON public.vacancies (club_id, status, updated_at DESC);

-- ============================================================================
-- VACANCY APPLICATIONS INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_vacancy_apps_vacancy_status
  ON public.vacancy_applications (vacancy_id, status, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_vacancy_apps_player_status
  ON public.vacancy_applications (player_id, status, applied_at DESC);

-- ============================================================================
-- MEDIA & HISTORY INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_gallery_photos_user_created
  ON public.gallery_photos (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_playing_history_user_display
  ON public.playing_history (user_id, display_order DESC);

CREATE INDEX IF NOT EXISTS idx_club_media_club_order
  ON public.club_media (club_id, order_index, created_at DESC);

-- ============================================================================
-- MESSAGING INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_conversations_participant_one
  ON public.conversations (participant_one_id);

CREATE INDEX IF NOT EXISTS idx_conversations_participant_two
  ON public.conversations (participant_two_id);

CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
  ON public.conversations (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message
  ON public.conversations (last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_conversations_participants_composite
  ON public.conversations (LEAST(participant_one_id, participant_two_id), GREATEST(participant_one_id, participant_two_id));

CREATE INDEX IF NOT EXISTS idx_conversations_id_participants
  ON public.conversations (id, participant_one_id, participant_two_id);

CREATE INDEX IF NOT EXISTS idx_conversations_unread
  ON public.conversations (participant_one_id, last_message_at DESC)
  WHERE last_message_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON public.messages (conversation_id);

CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON public.messages (sender_id);

CREATE INDEX IF NOT EXISTS idx_messages_sent_at
  ON public.messages (sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_unread_read_at
  ON public.messages (read_at)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_unread_lookup
  ON public.messages (conversation_id, sender_id, read_at)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_unread_by_conversation
  ON public.messages (conversation_id, sent_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_sent
  ON public.messages (conversation_id, sent_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency
  ON public.messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_idempotency_cleanup
  ON public.messages (sent_at)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- UNREAD MESSAGE VIEWS
-- ============================================================================
CREATE OR REPLACE VIEW public.user_unread_counts AS
WITH participant_one_unread AS (
  SELECT
    c.participant_one_id AS user_id,
    COUNT(m.id) AS unread_count
  FROM public.conversations c
  INNER JOIN public.messages m ON m.conversation_id = c.id
  WHERE m.sender_id = c.participant_two_id
    AND m.read_at IS NULL
  GROUP BY c.participant_one_id
),
participant_two_unread AS (
  SELECT
    c.participant_two_id AS user_id,
    COUNT(m.id) AS unread_count
  FROM public.conversations c
  INNER JOIN public.messages m ON m.conversation_id = c.id
  WHERE m.sender_id = c.participant_one_id
    AND m.read_at IS NULL
  GROUP BY c.participant_two_id
)
SELECT user_id, SUM(unread_count) AS unread_count
FROM (
  SELECT * FROM participant_one_unread
  UNION ALL
  SELECT * FROM participant_two_unread
) combined
GROUP BY user_id;

CREATE OR REPLACE VIEW public.user_unread_counts_secure AS
SELECT user_id, unread_count
FROM public.user_unread_counts
WHERE user_id = auth.uid();

GRANT SELECT ON public.user_unread_counts TO authenticated;
GRANT SELECT ON public.user_unread_counts_secure TO authenticated;

COMMENT ON VIEW public.user_unread_counts IS 'Real-time unread message counts per user (leverages optimized indexes)';
COMMENT ON VIEW public.user_unread_counts_secure IS 'RLS wrapper exposing unread counts to the current user only';
