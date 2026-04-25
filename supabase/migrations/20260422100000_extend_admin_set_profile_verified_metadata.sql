-- =========================================================================
-- admin_set_profile_verified — Phase B2 — add provenance metadata
-- =========================================================================
-- Research-memo framing: verification is "admin-checked against a
-- federation's public panel listing". Capturing the source URL + optional
-- notes alongside the flip makes the audit trail actually useful — without
-- them, admins have no way to remember WHY a given profile was verified
-- three months later.
--
-- Metadata is written to admin_audit_logs.metadata (JSONB), not to the
-- profiles row — it's admin context, not public-facing data.
--
-- Backwards-compatible at the frontend level: both new params default NULL
-- so existing callers (pre-B2) keep working. Requires DROP + CREATE because
-- Postgres won't accept signature changes via CREATE OR REPLACE alone.
-- =========================================================================

DROP FUNCTION IF EXISTS public.admin_set_profile_verified(UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.admin_set_profile_verified(
  p_profile_id UUID,
  p_value BOOLEAN,
  p_source_url TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_value BOOLEAN;
  v_admin_id  UUID := auth.uid();
  v_metadata  JSONB;
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

  -- Normalize: trim, treat empty strings as NULL, strip null keys so the
  -- audit row stays compact when the admin didn't supply either field.
  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'source_url', NULLIF(trim(COALESCE(p_source_url, '')), ''),
    'notes',      NULLIF(trim(COALESCE(p_notes, '')), '')
  ));

  PERFORM public.admin_log_action(
    CASE WHEN p_value THEN 'mark_verified' ELSE 'unmark_verified' END,
    'profile',
    p_profile_id,
    jsonb_build_object('is_verified', v_old_value),
    jsonb_build_object('is_verified', p_value),
    v_metadata
  );

  RETURN json_build_object(
    'success', true,
    'profile_id', p_profile_id,
    'is_verified', p_value
  );
END;
$$;

COMMENT ON FUNCTION public.admin_set_profile_verified IS
  'Admin-only grant/revoke of profile verified flag. Optional p_source_url and p_notes are recorded in admin_audit_logs.metadata for provenance (e.g., federation panel URL admin checked against).';

GRANT EXECUTE ON FUNCTION public.admin_set_profile_verified(UUID, BOOLEAN, TEXT, TEXT) TO authenticated;
