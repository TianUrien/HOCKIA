-- =========================================================================
-- touch_profile_activity — keep profiles.last_active_at fresh
-- =========================================================================
-- Root cause of the "Active recently" Snapshot signal always rendering as
-- missing: the column was added in 202512241000_admin_analytics_schema.sql
-- with a comment but NO writer ever shipped. Every user's last_active_at
-- has been NULL since the column was added.
--
-- This RPC stamps NOW() into the caller's own row, idempotently:
--   - skips if last_active_at was updated in the last hour (cheap throttle
--     that prevents a write on every page load while still feeling "live")
--   - SECURITY DEFINER so it bypasses RLS for the targeted UPDATE on the
--     caller's own row only (auth.uid() guard inside the body)
--
-- Called by useAuthStore.fetchProfile (fire-and-forget) after the profile
-- loads. Costs at most one UPDATE per session per hour per user.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.touch_profile_activity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.profiles
     SET last_active_at = timezone('utc', now())
   WHERE id = v_uid
     AND (
       last_active_at IS NULL
       OR last_active_at < timezone('utc', now()) - INTERVAL '1 hour'
     );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_profile_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_profile_activity() TO authenticated;

COMMENT ON FUNCTION public.touch_profile_activity() IS
  'Stamps profiles.last_active_at = NOW() for the calling user, throttled to once per hour. Called fire-and-forget from the auth store after profile fetch. Drives the "Active recently" Snapshot signal.';
