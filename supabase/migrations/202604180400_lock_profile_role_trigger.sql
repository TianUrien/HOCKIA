-- Wire the prevent_role_change function as a trigger on public.profiles
--
-- The function was added in 202603190100_rebrand_playr_to_hockia.sql but no
-- CREATE TRIGGER statement ever attached it to the table. As a result, the
-- role-lock only applied to changes routed through the complete_user_profile
-- RPC — any authenticated user could PATCH /rest/v1/profiles?id=eq.<self>
-- with {"role": "<anything>"} and the RLS UPDATE policy (which checks only
-- auth.uid() = id) would allow it.
--
-- The function is also tweaked to exempt service_role so that administrative
-- role edits (e.g., via complete_user_profile called with a service key) keep
-- working.

SET search_path = public;

CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Administrative callers (service_role) may change roles.
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Profile role is managed by HOCKIA staff'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_role_change ON public.profiles;
CREATE TRIGGER prevent_profile_role_change
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_change();

NOTIFY pgrst, 'reload schema';
