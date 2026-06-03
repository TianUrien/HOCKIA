-- ─────────────────────────────────────────────────────────────────────
-- Candidate intent fields — the 🤝 "Interested" lens (Matching Increment #2.1)
-- ─────────────────────────────────────────────────────────────────────
-- Field-hockey recruitment is bidirectional: two identical players are
-- different CANDIDATES depending on motivation + openness (relocate? which
-- countries? paid vs development? available when?). Today profiles only
-- carry the open_to_* on/off flags. This adds the structured intent the
-- Interested lens (Increment #2.2) will score, and the profile UI will
-- collect via a "Recruitment preferences" section.
--
-- All columns are NULLABLE / default-empty so they never block a profile
-- and missing data stays NEUTRAL in matching (same philosophy as the
-- Proven lens). CHECK constraints allow NULL plus the known enum values.
--
-- Columns live on public.profiles (an existing table) so the standard
-- profiles RLS + grants already apply — no new GRANTs needed.

BEGIN;

ALTER TABLE public.profiles
  -- Relocation willingness — the #1 international signal.
  ADD COLUMN IF NOT EXISTS relocation_willingness TEXT,
  -- Countries the candidate is open to / would not consider (countries.id).
  ADD COLUMN IF NOT EXISTS relocation_countries_open INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS relocation_countries_excluded INTEGER[] NOT NULL DEFAULT '{}',
  -- Ambition: what standard are they targeting.
  ADD COLUMN IF NOT EXISTS level_target TEXT,
  -- Motivation: paid vs development vs either.
  ADD COLUMN IF NOT EXISTS opportunity_preference TEXT,
  -- Availability window (hemisphere-season imports care a lot).
  ADD COLUMN IF NOT EXISTS available_from DATE,
  ADD COLUMN IF NOT EXISTS availability_duration TEXT;

-- Enum guards (allow NULL = "not stated").
ALTER TABLE public.profiles
  ADD CONSTRAINT chk_relocation_willingness
    CHECK (relocation_willingness IS NULL OR relocation_willingness IN ('relocate', 'home_only', 'open_to_discuss')),
  ADD CONSTRAINT chk_level_target
    CHECK (level_target IS NULL OR level_target IN ('top', 'competitive', 'development', 'any')),
  ADD CONSTRAINT chk_opportunity_preference
    CHECK (opportunity_preference IS NULL OR opportunity_preference IN ('paid', 'development', 'either')),
  ADD CONSTRAINT chk_availability_duration
    CHECK (availability_duration IS NULL OR availability_duration IN ('full_season', 'half_season', 'short_term', 'flexible'));

COMMENT ON COLUMN public.profiles.relocation_willingness IS
  'Candidate intent (Interested lens): relocate | home_only | open_to_discuss. NULL = not stated (neutral in matching).';
COMMENT ON COLUMN public.profiles.relocation_countries_open IS
  'countries.id list the candidate is open to playing in. Empty = no preference.';
COMMENT ON COLUMN public.profiles.relocation_countries_excluded IS
  'countries.id list the candidate would not consider. Empty = none excluded.';
COMMENT ON COLUMN public.profiles.level_target IS
  'Candidate ambition: top | competitive | development | any. NULL = not stated.';
COMMENT ON COLUMN public.profiles.opportunity_preference IS
  'Candidate motivation: paid | development | either. NULL = not stated.';
COMMENT ON COLUMN public.profiles.available_from IS
  'Earliest date the candidate can start. NULL = not stated / available now.';
COMMENT ON COLUMN public.profiles.availability_duration IS
  'How long: full_season | half_season | short_term | flexible. NULL = not stated.';

COMMIT;
