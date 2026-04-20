-- =========================================================================
-- profiles.is_verified — admin-granted trust badge
-- =========================================================================
-- Distinct from the Rookie/Active/Rising/Elite tier system (which is
-- computed client-side from profile strength). Verified is admin-granted,
-- shown as a small blue check next to the member's name.
--
-- Brands keep their existing `brands.is_verified` column untouched; unifying
-- the two sources is deliberately out of scope for this PR (would require a
-- data migration + edits across brand feed / search / card components).
--
-- Mirrors the `admin_set_test_account` RPC pattern: SECURITY DEFINER,
-- is_platform_admin() gate, admin_log_action() audit trail, JSON result.
-- =========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.is_verified IS
  'Admin-granted trust badge. Distinct from the computed profile tier. Flip via admin_set_profile_verified().';
COMMENT ON COLUMN public.profiles.verified_at IS
  'When the current verification was granted. Cleared when is_verified is revoked.';
COMMENT ON COLUMN public.profiles.verified_by IS
  'Admin profile that granted the current verification. Cleared when is_verified is revoked.';

-- Fast lookups on verified-only feeds (small index — tiny subset).
CREATE INDEX IF NOT EXISTS profiles_is_verified_idx
  ON public.profiles (is_verified) WHERE is_verified = TRUE;

-- =========================================================================
-- Admin RPC: set / unset verification
-- =========================================================================
-- Mirrors admin_set_test_account. Returns the old + new values and writes
-- to admin_audit_logs via admin_log_action().
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_set_profile_verified(
  p_profile_id UUID,
  p_value BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_value BOOLEAN;
  v_admin_id  UUID := auth.uid();
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT is_verified
    INTO v_old_value
    FROM public.profiles
   WHERE id = p_profile_id;

  IF v_old_value IS NULL THEN
    RAISE EXCEPTION 'Profile not found: %', p_profile_id;
  END IF;

  UPDATE public.profiles
     SET is_verified = p_value,
         verified_at = CASE WHEN p_value THEN now() ELSE NULL END,
         verified_by = CASE WHEN p_value THEN v_admin_id ELSE NULL END,
         updated_at  = now()
   WHERE id = p_profile_id;

  PERFORM public.admin_log_action(
    CASE WHEN p_value THEN 'mark_verified' ELSE 'unmark_verified' END,
    'profile',
    p_profile_id,
    jsonb_build_object('is_verified', v_old_value),
    jsonb_build_object('is_verified', p_value),
    '{}'::JSONB
  );

  RETURN json_build_object(
    'success', true,
    'profile_id', p_profile_id,
    'is_verified', p_value
  );
END;
$$;

COMMENT ON FUNCTION public.admin_set_profile_verified IS
  'Admin-only grant/revoke of the profile verified flag. Writes to admin_audit_logs.';

GRANT EXECUTE ON FUNCTION public.admin_set_profile_verified(UUID, BOOLEAN) TO authenticated;
