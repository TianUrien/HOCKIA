-- =========================================================================
-- Umpire role — Phase A: DB plumbing
-- =========================================================================
-- Opens the profiles.role allowlist to include 'umpire', adds nullable
-- umpire-specific columns, and guards them role-scoped so they can't leak
-- onto other roles. No values-constraint on umpire_level / federation —
-- the taxonomy is deliberately flexible; we'll tighten it once we've
-- talked to real umpires.
--
-- Languages is new (not umpire-scoped): umpires need it today and other
-- roles may use it later.
-- =========================================================================

-- 1. Extend role allowlist
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['player'::text, 'coach'::text, 'club'::text, 'brand'::text, 'umpire'::text]));

-- 2. Add umpire-specific nullable columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS umpire_level TEXT,
  ADD COLUMN IF NOT EXISTS federation TEXT,
  ADD COLUMN IF NOT EXISTS umpire_since SMALLINT,
  ADD COLUMN IF NOT EXISTS officiating_specialization TEXT,
  ADD COLUMN IF NOT EXISTS languages TEXT[];

COMMENT ON COLUMN public.profiles.umpire_level IS
  'Free-text umpire certification level. Kept flexible in v1; canonicalize later once we see real data.';
COMMENT ON COLUMN public.profiles.federation IS
  'Free-text federation / hockey body affiliation. FK to a federations table is a future migration.';
COMMENT ON COLUMN public.profiles.umpire_since IS
  'Year of first umpire certification.';
COMMENT ON COLUMN public.profiles.officiating_specialization IS
  'Constrained to outdoor | indoor | both.';
COMMENT ON COLUMN public.profiles.languages IS
  'Languages spoken. Added with the umpire role but role-agnostic by design.';

-- 3. Guard: umpire fields only when role='umpire' (mirrors chk_coach_specialization_role)
ALTER TABLE public.profiles ADD CONSTRAINT chk_umpire_fields_role
  CHECK (
    role = 'umpire' OR
    (umpire_level IS NULL
      AND federation IS NULL
      AND umpire_since IS NULL
      AND officiating_specialization IS NULL)
  );

-- 4. Lightweight values constraint on officiating_specialization (matches chk_profiles_gender pattern)
ALTER TABLE public.profiles ADD CONSTRAINT chk_officiating_specialization_values
  CHECK (
    officiating_specialization IS NULL
    OR officiating_specialization = ANY (ARRAY['outdoor'::text, 'indoor'::text, 'both'::text])
  );

-- 5. Sanity bounds on umpire_since (avoid CURRENT_DATE — non-immutable in CHECK)
ALTER TABLE public.profiles ADD CONSTRAINT chk_umpire_since_range
  CHECK (umpire_since IS NULL OR (umpire_since >= 1950 AND umpire_since <= 2100));
