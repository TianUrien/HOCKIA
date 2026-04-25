-- =========================================================================
-- profiles.last_officiated_at — Phase D: activity signal for umpires
-- =========================================================================
-- Derived from umpire_appointments: MAX(COALESCE(end_date, start_date)) per
-- user. Denormalized onto profiles so the community grid and search cards
-- can render "Active this season" / "Last officiated: Mar 2026" pills
-- without a per-row join.
--
-- Unlike umpire_appointment_count (which only moves on INSERT/DELETE), this
-- value depends on dates that CAN change during an UPDATE — so the trigger
-- fires on INSERT OR UPDATE OR DELETE, and recomputes for both OLD.user_id
-- and NEW.user_id when they differ (admin record-move edge case).
--
-- Recompute is O(N) per mutation where N = user's appointment count. Users
-- will have dozens, not millions — cheaper than maintaining a sorted index
-- of end_dates per user, and correct by construction.
-- =========================================================================

-- 1. Column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_officiated_at DATE;

COMMENT ON COLUMN public.profiles.last_officiated_at IS
  'MAX(COALESCE(end_date, start_date)) over umpire_appointments for this user. Maintained by trg_profile_last_officiated_at. NULL when the user has no dated appointments.';

CREATE INDEX IF NOT EXISTS profiles_last_officiated_at_idx
  ON public.profiles (last_officiated_at DESC NULLS LAST)
  WHERE last_officiated_at IS NOT NULL;

-- 2. Trigger function — recompute the aggregate for one or two user rows
CREATE OR REPLACE FUNCTION public.update_profile_last_officiated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Recompute for NEW.user_id on INSERT + UPDATE
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.profiles
       SET last_officiated_at = (
         SELECT MAX(COALESCE(a.end_date, a.start_date))
           FROM public.umpire_appointments a
          WHERE a.user_id = NEW.user_id
       )
     WHERE id = NEW.user_id;
  END IF;

  -- Recompute for OLD.user_id on DELETE, or on UPDATE that reassigns user_id
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    UPDATE public.profiles
       SET last_officiated_at = (
         SELECT MAX(COALESCE(a.end_date, a.start_date))
           FROM public.umpire_appointments a
          WHERE a.user_id = OLD.user_id
       )
     WHERE id = OLD.user_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_profile_last_officiated_at
  AFTER INSERT OR UPDATE OR DELETE ON public.umpire_appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_profile_last_officiated_at();

-- 3. Backfill — compute for any profile with existing appointments.
UPDATE public.profiles p
   SET last_officiated_at = sub.last_at
  FROM (
    SELECT user_id, MAX(COALESCE(end_date, start_date)) AS last_at
      FROM public.umpire_appointments
     GROUP BY user_id
  ) sub
 WHERE p.id = sub.user_id
   AND p.last_officiated_at IS DISTINCT FROM sub.last_at;
