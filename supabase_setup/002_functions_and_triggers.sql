-- 002_tables.sql
-- Primary relational tables for the HOCKIA Supabase project
-- Run via: supabase db execute --file supabase_setup/002_functions_and_triggers.sql

SET search_path = public;

-- Drop dependent tables first to ensure a clean recreate in case prior partial runs succeeded
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP TABLE IF EXISTS public.vacancy_applications CASCADE;
DROP TABLE IF EXISTS public.vacancies CASCADE;
DROP TABLE IF EXISTS public.playing_history CASCADE;
DROP TABLE IF EXISTS public.profile_comments CASCADE;
DROP TABLE IF EXISTS public.club_media CASCADE;
DROP TABLE IF EXISTS public.gallery_photos CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ============================================================================
-- PROFILES TABLE
-- ============================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player', 'coach', 'club')),
  full_name TEXT,
  username TEXT,
  base_location TEXT,
  nationality TEXT,
  position TEXT,
  secondary_position TEXT,
  gender TEXT,
  date_of_birth DATE,
  avatar_url TEXT,
  highlight_video_url TEXT,
  current_club TEXT,
  club_history TEXT,
  bio TEXT,
  club_bio TEXT,
  league_division TEXT,
  contact_email TEXT,
  contact_email_public BOOLEAN NOT NULL DEFAULT false,
  website TEXT,
  year_founded INTEGER,
  passport_1 TEXT,
  passport_2 TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.profiles IS 'Core profile record shared by players, coaches, and clubs';
COMMENT ON COLUMN public.profiles.role IS 'player | coach | club';
COMMENT ON COLUMN public.profiles.onboarding_completed IS 'Flag used to surface completed profiles in Community and search';

-- ============================================================================
-- GALLERY PHOTOS
-- ============================================================================
CREATE TABLE public.gallery_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  caption TEXT,
  alt_text TEXT,
  file_name TEXT,
  file_size INTEGER,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT gallery_photos_file_size_check CHECK (file_size IS NULL OR file_size >= 0)
);

COMMENT ON TABLE public.gallery_photos IS 'Stores public gallery images for a profile (player & coach media tab)';

-- ============================================================================
-- CLUB MEDIA
-- ============================================================================
CREATE TABLE public.club_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  caption TEXT,
  alt_text TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.club_media IS 'Ordered media gallery for club profiles';

-- ============================================================================
-- PLAYING HISTORY
-- ============================================================================
CREATE TABLE public.playing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  club_name TEXT NOT NULL,
  position_role TEXT NOT NULL,
  years TEXT NOT NULL,
  division_league TEXT NOT NULL,
  highlights TEXT[] NOT NULL DEFAULT '{}',
  entry_type journey_entry_type NOT NULL DEFAULT 'club',
  location_city TEXT,
  location_country TEXT,
  start_date DATE,
  end_date DATE,
  description TEXT,
  badge_label TEXT,
  image_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.playing_history IS 'Chronological history for player/coach careers';

-- ============================================================================
-- PROFILE COMMENTS
-- ============================================================================
CREATE TABLE public.profile_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 10 AND 1000),
  rating comment_rating,
  status comment_status NOT NULL DEFAULT 'visible',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX profile_comments_profile_id_idx ON public.profile_comments (profile_id);
CREATE INDEX profile_comments_author_profile_id_idx ON public.profile_comments (author_profile_id);
CREATE UNIQUE INDEX profile_comments_active_unique
  ON public.profile_comments (profile_id, author_profile_id)
  WHERE status IN ('visible', 'hidden', 'reported');

COMMENT ON TABLE public.profile_comments IS 'Peer feedback and testimonials tied to public profiles.';
COMMENT ON COLUMN public.profile_comments.profile_id IS 'Profile receiving the comment.';
COMMENT ON COLUMN public.profile_comments.author_profile_id IS 'Profile that authored the comment.';
COMMENT ON COLUMN public.profile_comments.status IS 'Moderation lifecycle: visible | hidden | reported | deleted.';

-- ============================================================================
-- VACANCIES
-- ============================================================================
CREATE TABLE public.vacancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opportunity_type opportunity_type NOT NULL DEFAULT 'player',
  title TEXT NOT NULL,
  position vacancy_position,
  gender vacancy_gender,
  description TEXT,
  location_city TEXT NOT NULL,
  location_country TEXT NOT NULL,
  start_date DATE,
  duration_text TEXT,
  requirements TEXT[] NOT NULL DEFAULT '{}',
  benefits TEXT[] NOT NULL DEFAULT '{}',
  custom_benefits TEXT[] NOT NULL DEFAULT '{}',
  priority vacancy_priority DEFAULT 'medium',
  status vacancy_status NOT NULL DEFAULT 'draft',
  application_deadline DATE,
  contact_email TEXT,
  contact_phone TEXT,
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.vacancies IS 'Club posted opportunities for players or coaches';

-- ============================================================================
-- VACANCY APPLICATIONS
-- ============================================================================
CREATE TABLE public.vacancy_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id UUID NOT NULL REFERENCES public.vacancies(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cover_letter TEXT,
  status application_status NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT vacancy_applications_unique UNIQUE (vacancy_id, player_id)
);

COMMENT ON TABLE public.vacancy_applications IS 'Tracks player/coach applications to vacancies with status history';

-- ============================================================================
-- CONVERSATIONS
-- ============================================================================
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_one_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  participant_two_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  last_message_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT conversations_participants_distinct CHECK (participant_one_id <> participant_two_id)
);

COMMENT ON TABLE public.conversations IS 'Direct message channel between two profiles';

CREATE UNIQUE INDEX conversations_participant_pair_unique
  ON public.conversations (
    LEAST(participant_one_id, participant_two_id),
    GREATEST(participant_one_id, participant_two_id)
  );

-- ============================================================================
-- MESSAGES
-- ============================================================================
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  read_at TIMESTAMPTZ,
  idempotency_key TEXT,
  CONSTRAINT messages_length_enforced CHECK (char_length(content) > 0 AND char_length(content) <= 1000)
);

COMMENT ON TABLE public.messages IS 'Individual messages with read receipts and idempotency protection';
