-- Add a `zero_activity` filter to admin_search_profiles so the Overview
-- "zero-activity users" tile can drill into the actual cohort. The tile linked
-- to /admin/directory?zero_activity=1 but no filter consumed the param, so it
-- dumped the admin on the unfiltered directory.
--
-- Definition mirrors admin_get_zero_activity_users (the RPC that powers the
-- tile's count): a NON-test profile that signed up >= 7 days ago and has logged
-- NONE of the 6 value-action events.
--
-- Adding a parameter changes the signature, so DROP + CREATE (Postgres rejects
-- a signature change via CREATE OR REPLACE). Safe to deploy ahead of the client:
-- the new param has a DEFAULT and PostgREST resolves RPCs by argument NAME, so
-- the previously-deployed 7-arg client still resolves to this function with
-- p_zero_activity defaulting to NULL (= no filter).
DROP FUNCTION IF EXISTS public.admin_search_profiles(text, text, boolean, boolean, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_search_profiles(
  p_query TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_is_blocked BOOLEAN DEFAULT NULL,
  p_is_test_account BOOLEAN DEFAULT NULL,
  p_onboarding_completed BOOLEAN DEFAULT NULL,
  p_zero_activity BOOLEAN DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  full_name TEXT,
  username TEXT,
  role TEXT,
  nationality TEXT,
  nationality2 TEXT,
  base_location TEXT,
  is_blocked BOOLEAN,
  is_test_account BOOLEAN,
  is_verified BOOLEAN,
  onboarding_completed BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  avatar_url TEXT,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_count BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT COUNT(*)
  INTO v_total_count
  FROM profiles p
  WHERE
    (p_query IS NULL OR (
      p.email ILIKE '%' || p_query || '%' OR
      p.full_name ILIKE '%' || p_query || '%' OR
      p.username ILIKE '%' || p_query || '%' OR
      p.id::TEXT = p_query
    ))
    AND (p_role IS NULL OR p.role = p_role)
    AND (p_is_blocked IS NULL OR p.is_blocked = p_is_blocked)
    AND (p_is_test_account IS NULL OR p.is_test_account = p_is_test_account)
    AND (p_onboarding_completed IS NULL OR p.onboarding_completed = p_onboarding_completed)
    -- Zero-activity cohort (mirrors admin_get_zero_activity_users): non-test,
    -- signed up >= 7 days ago, and no value-action event logged.
    AND (NOT COALESCE(p_zero_activity, FALSE) OR (
      p.is_test_account = FALSE
      AND p.created_at <= now() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM events e
        WHERE e.user_id = p.id
          AND e.event_name IN (
            'application_submit', 'message_send', 'friend_request_send',
            'post_create', 'reference_request_send', 'profile_update'
          )
      )
    ));

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.username,
    p.role,
    COALESCE(c.name, p.nationality) AS nationality,
    c2.name AS nationality2,
    p.base_location,
    p.is_blocked,
    p.is_test_account,
    p.is_verified,
    p.onboarding_completed,
    p.created_at,
    p.updated_at,
    p.avatar_url,
    v_total_count AS total_count
  FROM profiles p
  LEFT JOIN countries c ON c.id = p.nationality_country_id
  LEFT JOIN countries c2 ON c2.id = p.nationality2_country_id
  WHERE
    (p_query IS NULL OR (
      p.email ILIKE '%' || p_query || '%' OR
      p.full_name ILIKE '%' || p_query || '%' OR
      p.username ILIKE '%' || p_query || '%' OR
      p.id::TEXT = p_query
    ))
    AND (p_role IS NULL OR p.role = p_role)
    AND (p_is_blocked IS NULL OR p.is_blocked = p_is_blocked)
    AND (p_is_test_account IS NULL OR p.is_test_account = p_is_test_account)
    AND (p_onboarding_completed IS NULL OR p.onboarding_completed = p_onboarding_completed)
    AND (NOT COALESCE(p_zero_activity, FALSE) OR (
      p.is_test_account = FALSE
      AND p.created_at <= now() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM events e
        WHERE e.user_id = p.id
          AND e.event_name IN (
            'application_submit', 'message_send', 'friend_request_send',
            'post_create', 'reference_request_send', 'profile_update'
          )
      )
    ))
  ORDER BY p.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_search_profiles(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
