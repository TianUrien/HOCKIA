-- =========================================================================
-- umpire_appointments → Officiating Journey (entry_type discriminator)
-- =========================================================================
-- Phase F2: the umpire_appointments table becomes a richer officiating
-- journey that mixes match-level appointments with career narrative:
-- milestones, certifications earned, panel inductions. Players have an
-- equivalent via career_history.entry_type — same pattern here.
--
-- Table name intentionally preserved (umpire_appointments). The table
-- keeps working for every existing row (entry_type defaults to
-- 'appointment'), so no client needs updating to read old data.
--
-- Denormalized-count trigger unchanged: umpire_appointment_count now
-- reflects total journey entries regardless of type. That matches the
-- useUmpireProfileStrength bucket "Officiating History" which asks
-- "does this umpire have any officiating history?" — any entry counts.
--
-- last_officiated_at trigger IS updated to filter entry_type='appointment'
-- because the activity pill specifically signals "when did they last
-- officiate a match", not "when did they earn their last certification".
-- =========================================================================

-- 1. Enum for the discriminator
DO $$ BEGIN
  CREATE TYPE public.umpire_journey_entry_type AS ENUM (
    'appointment',     -- specific match / tournament officiated
    'milestone',       -- career milestone (first international, 100th match, award)
    'certification',   -- earned / renewed a certification
    'panel'            -- panel induction or membership start
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add entry_type column with a safe default. Backfill is implicit via
--    DEFAULT — all existing rows become 'appointment', which is correct
--    because every pre-F2 row was created as a match appointment.
ALTER TABLE public.umpire_appointments
  ADD COLUMN IF NOT EXISTS entry_type public.umpire_journey_entry_type
    NOT NULL DEFAULT 'appointment';

COMMENT ON COLUMN public.umpire_appointments.entry_type IS
  'Journey entry discriminator. appointment = match officiated; milestone = career milestone; certification = credential earned; panel = panel membership. Drives section icon + color + field visibility in UmpireAppointmentEditor.';

-- 3. Index for filtered queries (e.g., upcoming appointments only,
--    milestones timeline, certifications count).
CREATE INDEX IF NOT EXISTS umpire_appointments_user_entry_type_date_idx
  ON public.umpire_appointments (user_id, entry_type, start_date DESC NULLS LAST);

-- 4. Update last_officiated_at trigger to filter appointment rows only.
--    Milestones / certifications / panels should NOT push the "Active
--    this season" pill because they're not match activity.
CREATE OR REPLACE FUNCTION public.update_profile_last_officiated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Recompute for NEW.user_id on INSERT + UPDATE (match activity only).
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.profiles
       SET last_officiated_at = (
         SELECT MAX(COALESCE(a.end_date, a.start_date))
           FROM public.umpire_appointments a
          WHERE a.user_id = NEW.user_id
            AND a.entry_type = 'appointment'
       )
     WHERE id = NEW.user_id;
  END IF;

  -- Recompute for OLD.user_id on DELETE, or on UPDATE that reassigns user_id.
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    UPDATE public.profiles
       SET last_officiated_at = (
         SELECT MAX(COALESCE(a.end_date, a.start_date))
           FROM public.umpire_appointments a
          WHERE a.user_id = OLD.user_id
            AND a.entry_type = 'appointment'
       )
     WHERE id = OLD.user_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger binding is unchanged; function body above is the REPLACEable bit.
-- Also applies when entry_type is changed on an existing row (e.g., a
-- milestone reclassified as an appointment), since the trigger fires on
-- any UPDATE to the row.

-- 5. One-time backfill: recompute last_officiated_at for any profile that
--    currently has a non-appointment entry as its latest — shouldn't exist
--    pre-migration since every row was 'appointment', but the idempotent
--    statement is cheap insurance.
UPDATE public.profiles p
   SET last_officiated_at = sub.last_at
  FROM (
    SELECT user_id, MAX(COALESCE(end_date, start_date)) AS last_at
      FROM public.umpire_appointments
     WHERE entry_type = 'appointment'
     GROUP BY user_id
  ) sub
 WHERE p.id = sub.user_id
   AND p.last_officiated_at IS DISTINCT FROM sub.last_at;
