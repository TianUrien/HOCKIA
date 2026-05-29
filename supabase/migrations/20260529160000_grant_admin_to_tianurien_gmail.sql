-- ============================================================================
-- Grant admin access to tianurien@gmail.com
-- ============================================================================
-- Parity grant to the existing tianurien@hotmail.com admin (granted in
-- 202603171530_grant_admin_to_tianurien_hotmail.sql). Lets Tian
-- operate the admin portal from whichever inbox he reads first —
-- especially relevant for the upcoming user-feedback notification
-- emails which will route to gmail by default.
--
-- Idempotent: the WHERE clause skips the UPDATE when is_admin is
-- already true, so re-running on a DB where the grant already exists
-- (or was set out-of-band via SQL editor) is a no-op.
-- ============================================================================

DO $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('is_admin', true)
  WHERE lower(email) = 'tianurien@gmail.com'
    AND COALESCE((raw_app_meta_data ->> 'is_admin')::boolean, false) = false;
END;
$$;
