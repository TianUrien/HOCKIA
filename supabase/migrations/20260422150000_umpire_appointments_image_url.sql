-- =========================================================================
-- umpire_appointments.image_url — one photo per appointment
-- =========================================================================
-- Richer credibility display: a single event photo lets umpires show the
-- badge / scoreboard / venue they officiated at. Stored in the existing
-- 'journey' bucket under the user's own path, so we reuse the bucket RLS
-- and don't need a new storage policy.
--
-- Convention: '{user_id}/umpire/{timestamp}_{random}.{ext}' — mirrors the
-- JourneyTab path convention with a 'umpire' subfolder so we can reason
-- about storage usage per-feature later.
-- =========================================================================

ALTER TABLE public.umpire_appointments
  ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN public.umpire_appointments.image_url IS
  'Optional event photo. Uploaded via the journey storage bucket under {uid}/umpire/. Owner-only upload/delete is enforced by the journey bucket RLS (path prefix must equal auth.uid()).';
