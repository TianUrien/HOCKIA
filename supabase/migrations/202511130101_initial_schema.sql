-- 001_initial_schema.sql
-- Core schema objects for HOCKIA Supabase project
-- Run via: supabase db execute --file supabase_setup/001_initial_schema.sql

SET search_path = public;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- ============================================================================
-- ENUM TYPES
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE opportunity_type AS ENUM ('player', 'coach');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vacancy_position AS ENUM ('goalkeeper', 'defender', 'midfielder', 'forward');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vacancy_gender AS ENUM ('Men', 'Women');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vacancy_priority AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vacancy_status AS ENUM ('draft', 'open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE application_status AS ENUM (
    'pending',
    'reviewed',
    'shortlisted',
    'interview',
    'accepted',
    'rejected',
    'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE journey_entry_type AS ENUM (
    'club',
    'national_team',
    'achievement',
    'tournament',
    'milestone',
    'academy',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PROFILES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
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

-- Unique index to prevent duplicate emails in a case-insensitive manner
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
  ON public.profiles (LOWER(email));

COMMENT ON TABLE public.profiles IS 'Core profile record shared by players, coaches, and clubs';
COMMENT ON COLUMN public.profiles.role IS 'player | coach | club';
COMMENT ON COLUMN public.profiles.onboarding_completed IS 'Flag used to surface completed profiles in Community and search';

-- ============================================================================
-- GALLERY PHOTOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.gallery_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.gallery_photos IS 'Stores public gallery images for a profile (player & coach media tab)';

-- ============================================================================
-- CLUB MEDIA
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.club_media (
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
CREATE TABLE IF NOT EXISTS public.playing_history (
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
-- VACANCIES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vacancies (
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
CREATE TABLE IF NOT EXISTS public.vacancy_applications (
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
CREATE TABLE IF NOT EXISTS public.conversations (
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

-- ============================================================================
-- MESSAGES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.messages (
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
