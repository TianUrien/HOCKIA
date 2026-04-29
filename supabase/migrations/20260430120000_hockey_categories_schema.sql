-- Phase 3a: Hockey category model — schema additions + backfill from gender.
-- Replaces the universal "gender" question with role-specific hockey-category
-- context. See planning doc for product reasoning.
--
-- Strategy: dual-write era. New columns added; existing gender column kept
-- in place. Phase 3b–3e migrate read paths. Phase 3f drops gender after a
-- 30-day soak with both columns populated.

-- ────────────────────────────────────────────────────────────────────────
-- 1. New columns
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS playing_category TEXT,
  ADD COLUMN IF NOT EXISTS coaching_categories TEXT[],
  ADD COLUMN IF NOT EXISTS umpiring_categories TEXT[],
  ADD COLUMN IF NOT EXISTS category_confirmation_needed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.playing_category IS
  'Player playing category. Single value. One of: adult_women, adult_men, girls, boys, mixed. Phase 3 replacement for gender.';

COMMENT ON COLUMN public.profiles.coaching_categories IS
  'Coach categories array. Values: adult_women, adult_men, girls, boys, mixed, or [any]. Empty/null = not yet specified.';

COMMENT ON COLUMN public.profiles.umpiring_categories IS
  'Umpire categories array. Same value set as coaching_categories.';

COMMENT ON COLUMN public.profiles.category_confirmation_needed IS
  'TRUE when gender→category backfill was best-effort (e.g. coach gender mapped to single adult_X). User sees a one-time confirm prompt; cleared on confirm.';

-- ────────────────────────────────────────────────────────────────────────
-- 2. CHECK constraints
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD CONSTRAINT chk_profiles_playing_category
  CHECK (
    playing_category IS NULL
    OR playing_category = ANY (ARRAY['adult_women','adult_men','girls','boys','mixed']::text[])
  );

-- Coaches/umpires: array values must be from the allowed set; 'any' accepted.
-- Empty arrays disallowed (use NULL for "not specified") — keeps queries simpler.
ALTER TABLE public.profiles ADD CONSTRAINT chk_profiles_coaching_categories
  CHECK (
    coaching_categories IS NULL
    OR (
      array_length(coaching_categories, 1) >= 1
      AND coaching_categories <@ ARRAY['adult_women','adult_men','girls','boys','mixed','any']::text[]
    )
  );

ALTER TABLE public.profiles ADD CONSTRAINT chk_profiles_umpiring_categories
  CHECK (
    umpiring_categories IS NULL
    OR (
      array_length(umpiring_categories, 1) >= 1
      AND umpiring_categories <@ ARRAY['adult_women','adult_men','girls','boys','mixed','any']::text[]
    )
  );

-- 'any' must be the only element when used (you can't mix "any" + specific picks).
ALTER TABLE public.profiles ADD CONSTRAINT chk_coaching_any_exclusive
  CHECK (
    coaching_categories IS NULL
    OR NOT ('any' = ANY(coaching_categories))
    OR array_length(coaching_categories, 1) = 1
  );

ALTER TABLE public.profiles ADD CONSTRAINT chk_umpiring_any_exclusive
  CHECK (
    umpiring_categories IS NULL
    OR NOT ('any' = ANY(umpiring_categories))
    OR array_length(umpiring_categories, 1) = 1
  );

-- ────────────────────────────────────────────────────────────────────────
-- 3. Backfill from existing gender data
-- ────────────────────────────────────────────────────────────────────────
-- Players: deterministic mapping.
UPDATE public.profiles
SET playing_category = CASE
  WHEN gender = 'Men' THEN 'adult_men'
  WHEN gender = 'Women' THEN 'adult_women'
  ELSE NULL
END
WHERE role = 'player' AND gender IS NOT NULL;

-- Coaches: best-effort mapping. Flag for confirmation prompt.
UPDATE public.profiles
SET coaching_categories = CASE
  WHEN gender = 'Men' THEN ARRAY['adult_men']::text[]
  WHEN gender = 'Women' THEN ARRAY['adult_women']::text[]
  ELSE NULL
END,
    category_confirmation_needed = (gender IS NOT NULL)
WHERE role = 'coach';

-- Umpires: no historical gender data on prod. Nothing to backfill.

-- ────────────────────────────────────────────────────────────────────────
-- 4. Indexes for matching queries
-- ────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_playing_category
  ON public.profiles (playing_category)
  WHERE role = 'player' AND playing_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_coaching_categories
  ON public.profiles USING GIN (coaching_categories)
  WHERE role = 'coach' AND coaching_categories IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_umpiring_categories
  ON public.profiles USING GIN (umpiring_categories)
  WHERE role = 'umpire' AND umpiring_categories IS NOT NULL;
