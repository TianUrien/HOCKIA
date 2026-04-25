-- =========================================================================
-- umpire_appointments — Phase C: officiating history
-- =========================================================================
-- Credibility signal for umpires: "what I've officiated". Mirrors
-- career_history in shape (owner-write + public-read, denormalized count,
-- chronological display) but adds umpire-specific fields:
--   - match_level    — free text (FIH, National, Regional… taxonomy varies)
--   - match_format   — outdoor_11v11 | indoor_5v5 | other
--   - organizer      — federation / league / tournament running the match
--
-- No image column in v1 — keeping scope tight. Images + highlights can be
-- added in a follow-up without a data migration.
--
-- Phase D ("last officiated" pill) reads MAX(end_date) from this table.
-- Phase C does NOT feed profileTier / profileCompletion weights — that's a
-- deliberate decision in the research memo, reconsidered once we see real
-- umpires filling this in.
-- =========================================================================

-- 1. Denormalized count on profiles (trigger-maintained)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS umpire_appointment_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.umpire_appointment_count IS
  'Count of umpire_appointments rows for this user. Maintained by trg_profile_umpire_appointment_count (INSERT/DELETE only, mirrors trg_profile_career_count).';

-- 2. Table
CREATE TABLE IF NOT EXISTS public.umpire_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  organizer TEXT,
  match_level TEXT,
  match_format TEXT,
  location_city TEXT,
  location_country TEXT,
  start_date DATE,
  end_date DATE,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.umpire_appointments IS
  'Officiating history entries. Owner-editable, public-read. Shown on UmpireDashboard and PublicUmpireProfile.';

-- 3. Constraints
-- Values constraint on match_format (mirrors chk_officiating_specialization_values).
-- match_level is intentionally free text — federation level taxonomies vary,
-- same reasoning as profiles.umpire_level.
ALTER TABLE public.umpire_appointments ADD CONSTRAINT chk_umpire_appointments_format
  CHECK (
    match_format IS NULL
    OR match_format = ANY (ARRAY['outdoor_11v11'::text, 'indoor_5v5'::text, 'other'::text])
  );

-- Keep end_date >= start_date when both set.
ALTER TABLE public.umpire_appointments ADD CONSTRAINT chk_umpire_appointments_date_order
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS umpire_appointments_user_id_idx
  ON public.umpire_appointments (user_id);

CREATE INDEX IF NOT EXISTS umpire_appointments_user_date_idx
  ON public.umpire_appointments (user_id, start_date DESC NULLS LAST);

-- 5. RLS — public read + owner write (mirrors career_history policies)
ALTER TABLE public.umpire_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view umpire appointments"
  ON public.umpire_appointments FOR SELECT USING (true);

CREATE POLICY "Users can insert own umpire appointments"
  ON public.umpire_appointments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own umpire appointments"
  ON public.umpire_appointments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own umpire appointments"
  ON public.umpire_appointments FOR DELETE
  USING (auth.uid() = user_id);

-- 6. updated_at trigger
CREATE OR REPLACE FUNCTION public.set_umpire_appointments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_umpire_appointments_updated_at
  BEFORE UPDATE ON public.umpire_appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_umpire_appointments_updated_at();

-- 7. Denormalized count trigger (mirrors update_profile_career_count exactly,
-- including the AFTER INSERT OR DELETE — not UPDATE — so edits don't
-- double-increment the count).
CREATE OR REPLACE FUNCTION public.update_profile_umpire_appointment_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.profiles
       SET umpire_appointment_count = GREATEST(0, umpire_appointment_count - 1)
     WHERE id = OLD.user_id;
    RETURN OLD;
  ELSE
    UPDATE public.profiles
       SET umpire_appointment_count = umpire_appointment_count + 1
     WHERE id = NEW.user_id;
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER trg_profile_umpire_appointment_count
  AFTER INSERT OR DELETE ON public.umpire_appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_profile_umpire_appointment_count();

-- 8. Backfill — new table starts empty, but keep the pattern for idempotency.
UPDATE public.profiles p
   SET umpire_appointment_count = COALESCE(
     (SELECT COUNT(*)::INTEGER FROM public.umpire_appointments a WHERE a.user_id = p.id),
     0
   )
 WHERE umpire_appointment_count IS DISTINCT FROM
   COALESCE(
     (SELECT COUNT(*)::INTEGER FROM public.umpire_appointments a WHERE a.user_id = p.id),
     0
   );
