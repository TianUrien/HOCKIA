-- 001_initial_schema.sql
-- Core schema objects for HOCKIA Supabase project
-- Run via: supabase db execute --file supabase_setup/001_initial_schema.sql

SET search_path = public;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'opportunity_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE opportunity_type AS ENUM ('player', 'coach');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'vacancy_position' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE vacancy_position AS ENUM ('goalkeeper', 'defender', 'midfielder', 'forward');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'vacancy_gender' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE vacancy_gender AS ENUM ('Men', 'Women');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'vacancy_priority' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE vacancy_priority AS ENUM ('low', 'medium', 'high');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'vacancy_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE vacancy_status AS ENUM ('draft', 'open', 'closed');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'application_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE application_status AS ENUM (
      'pending',
      'reviewed',
      'shortlisted',
      'interview',
      'accepted',
      'rejected',
      'withdrawn'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'journey_entry_type' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE journey_entry_type AS ENUM (
      'club',
      'national_team',
      'achievement',
      'tournament',
      'milestone',
      'academy',
      'other'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'comment_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE comment_status AS ENUM ('visible', 'hidden', 'reported', 'deleted');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'comment_rating' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE comment_rating AS ENUM ('positive', 'neutral', 'negative');
  END IF;
END
$$;

-- Table definitions live in 002_tables.sql to avoid duplicate creation across the setup sequence.
