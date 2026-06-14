-- ============================================================================
-- Umpire availability — dedicated `available_for_appointments` boolean
-- ============================================================================
-- Phase 2 (2b'). Umpires had no way to signal availability: the generic
-- `open_to_opportunities` flag is player/coach-framed (it drives "Open to new
-- opportunities" copy in nl-search + the AvailabilityToggleStrip tooltips), and
-- no umpire edit/onboarding surface ever wrote it — so the Community card's
-- umpire "Available" chip was permanently dark. A dedicated column matches the
-- umpire's trust-and-appointment framing and keeps the player/coach
-- "opportunities" semantics out of umpire AI/search context.
--
-- Read/write fences: a new client-editable + publicly-readable profiles column
-- is NOT covered by the existing column whitelists (anon SELECT fence
-- 20260611120000, authenticated write whitelist 20260612120000). Column GRANTs
-- are additive, so we grant just the new column here rather than re-listing.

-- 1. The column. NULL for non-umpire roles (guarded below).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS available_for_appointments BOOLEAN;

COMMENT ON COLUMN public.profiles.available_for_appointments IS
  'Umpire-only: the umpire is available to be appointed to matches. NULL for non-umpire roles (chk_umpire_fields_role). Drives the Community card "Available" chip + umpire availability search.';

-- 2. Extend the umpire-role field guard so the flag can never leak onto a
--    non-umpire row. Mirrors the existing umpire_level/federation/... guard.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS chk_umpire_fields_role;
ALTER TABLE public.profiles ADD CONSTRAINT chk_umpire_fields_role
  CHECK (
    role = 'umpire' OR
    (umpire_level IS NULL
      AND federation IS NULL
      AND umpire_since IS NULL
      AND officiating_specialization IS NULL
      AND available_for_appointments IS NULL)
  );

-- 3. Read fence — let anon + authenticated SELECT the new public column (the
--    card chip + search read it). Additive to 20260611120000's whitelist.
GRANT SELECT (available_for_appointments) ON public.profiles TO anon, authenticated;

-- 4. Write fence — let the owning umpire set it. Additive to 20260612120000's
--    write whitelist (without this, client UPDATE/INSERT 42501s).
GRANT INSERT (available_for_appointments), UPDATE (available_for_appointments)
  ON public.profiles TO authenticated;

-- 5. Backfill already-onboarded umpires to available (matches the onboarding
--    default we add client-side) so their card chip lights up without a manual
--    toggle. New non-umpire rows stay NULL.
UPDATE public.profiles
  SET available_for_appointments = true
  WHERE role = 'umpire' AND available_for_appointments IS NULL;
