-- =============================================================================
-- Admin Preference Analytics RPCs
--
-- 1. admin_get_preference_summary — counts per setting (enabled/disabled, by role)
-- 2. admin_get_preference_users — drill-down: which users have a setting on/off
-- =============================================================================


-- 1. Summary: counts per notification preference
CREATE OR REPLACE FUNCTION public.admin_get_preference_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_result JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.profiles
  WHERE onboarding_completed = true
    AND is_blocked = false
    AND is_test_account = false;

  SELECT jsonb_build_object(
    'total_users', v_total,
    'preferences', jsonb_build_object(
      'notify_applications', jsonb_build_object(
        'enabled', (SELECT COUNT(*) FROM profiles WHERE notify_applications = true AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'disabled', (SELECT COUNT(*) FROM profiles WHERE notify_applications = false AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'by_role', (
          SELECT COALESCE(jsonb_object_agg(role, counts), '{}'::jsonb)
          FROM (
            SELECT role, jsonb_build_object(
              'enabled', COUNT(*) FILTER (WHERE notify_applications = true),
              'disabled', COUNT(*) FILTER (WHERE notify_applications = false)
            ) AS counts
            FROM profiles
            WHERE onboarding_completed AND NOT is_blocked AND NOT is_test_account
            GROUP BY role
          ) sub
        )
      ),
      'notify_friends', jsonb_build_object(
        'enabled', (SELECT COUNT(*) FROM profiles WHERE notify_friends = true AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'disabled', (SELECT COUNT(*) FROM profiles WHERE notify_friends = false AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'by_role', (
          SELECT COALESCE(jsonb_object_agg(role, counts), '{}'::jsonb)
          FROM (
            SELECT role, jsonb_build_object(
              'enabled', COUNT(*) FILTER (WHERE notify_friends = true),
              'disabled', COUNT(*) FILTER (WHERE notify_friends = false)
            ) AS counts
            FROM profiles
            WHERE onboarding_completed AND NOT is_blocked AND NOT is_test_account
            GROUP BY role
          ) sub
        )
      ),
      'notify_references', jsonb_build_object(
        'enabled', (SELECT COUNT(*) FROM profiles WHERE notify_references = true AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'disabled', (SELECT COUNT(*) FROM profiles WHERE notify_references = false AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'by_role', (
          SELECT COALESCE(jsonb_object_agg(role, counts), '{}'::jsonb)
          FROM (
            SELECT role, jsonb_build_object(
              'enabled', COUNT(*) FILTER (WHERE notify_references = true),
              'disabled', COUNT(*) FILTER (WHERE notify_references = false)
            ) AS counts
            FROM profiles
            WHERE onboarding_completed AND NOT is_blocked AND NOT is_test_account
            GROUP BY role
          ) sub
        )
      ),
      'notify_messages', jsonb_build_object(
        'enabled', (SELECT COUNT(*) FROM profiles WHERE notify_messages = true AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'disabled', (SELECT COUNT(*) FROM profiles WHERE notify_messages = false AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'by_role', (
          SELECT COALESCE(jsonb_object_agg(role, counts), '{}'::jsonb)
          FROM (
            SELECT role, jsonb_build_object(
              'enabled', COUNT(*) FILTER (WHERE notify_messages = true),
              'disabled', COUNT(*) FILTER (WHERE notify_messages = false)
            ) AS counts
            FROM profiles
            WHERE onboarding_completed AND NOT is_blocked AND NOT is_test_account
            GROUP BY role
          ) sub
        )
      ),
      'notify_opportunities', jsonb_build_object(
        'enabled', (SELECT COUNT(*) FROM profiles WHERE notify_opportunities = true AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'disabled', (SELECT COUNT(*) FROM profiles WHERE notify_opportunities = false AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'by_role', (
          SELECT COALESCE(jsonb_object_agg(role, counts), '{}'::jsonb)
          FROM (
            SELECT role, jsonb_build_object(
              'enabled', COUNT(*) FILTER (WHERE notify_opportunities = true),
              'disabled', COUNT(*) FILTER (WHERE notify_opportunities = false)
            ) AS counts
            FROM profiles
            WHERE onboarding_completed AND NOT is_blocked AND NOT is_test_account
            GROUP BY role
          ) sub
        )
      ),
      'notify_push', jsonb_build_object(
        'enabled', (SELECT COUNT(*) FROM profiles WHERE notify_push = true AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'disabled', (SELECT COUNT(*) FROM profiles WHERE notify_push = false AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'by_role', (
          SELECT COALESCE(jsonb_object_agg(role, counts), '{}'::jsonb)
          FROM (
            SELECT role, jsonb_build_object(
              'enabled', COUNT(*) FILTER (WHERE notify_push = true),
              'disabled', COUNT(*) FILTER (WHERE notify_push = false)
            ) AS counts
            FROM profiles
            WHERE onboarding_completed AND NOT is_blocked AND NOT is_test_account
            GROUP BY role
          ) sub
        )
      ),
      'notify_profile_views', jsonb_build_object(
        'enabled', (SELECT COUNT(*) FROM profiles WHERE notify_profile_views = true AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'disabled', (SELECT COUNT(*) FROM profiles WHERE notify_profile_views = false AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'by_role', (
          SELECT COALESCE(jsonb_object_agg(role, counts), '{}'::jsonb)
          FROM (
            SELECT role, jsonb_build_object(
              'enabled', COUNT(*) FILTER (WHERE notify_profile_views = true),
              'disabled', COUNT(*) FILTER (WHERE notify_profile_views = false)
            ) AS counts
            FROM profiles
            WHERE onboarding_completed AND NOT is_blocked AND NOT is_test_account
            GROUP BY role
          ) sub
        )
      ),
      'browse_anonymously', jsonb_build_object(
        'enabled', (SELECT COUNT(*) FROM profiles WHERE browse_anonymously = true AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'disabled', (SELECT COUNT(*) FROM profiles WHERE browse_anonymously = false AND onboarding_completed AND NOT is_blocked AND NOT is_test_account),
        'by_role', (
          SELECT COALESCE(jsonb_object_agg(role, counts), '{}'::jsonb)
          FROM (
            SELECT role, jsonb_build_object(
              'enabled', COUNT(*) FILTER (WHERE browse_anonymously = true),
              'disabled', COUNT(*) FILTER (WHERE browse_anonymously = false)
            ) AS counts
            FROM profiles
            WHERE onboarding_completed AND NOT is_blocked AND NOT is_test_account
            GROUP BY role
          ) sub
        )
      )
    ),
    'generated_at', now()
  ) INTO v_result;

  RETURN v_result;
END;
$$;


-- 2. Drill-down: list users for a specific preference + state
CREATE OR REPLACE FUNCTION public.admin_get_preference_users(
  p_preference TEXT,
  p_enabled BOOLEAN DEFAULT true,
  p_role TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  IF p_preference NOT IN (
    'notify_applications', 'notify_friends', 'notify_references',
    'notify_messages', 'notify_opportunities', 'notify_push',
    'notify_profile_views', 'browse_anonymously'
  ) THEN
    RAISE EXCEPTION 'Invalid preference: %', p_preference;
  END IF;

  EXECUTE format(
    $q$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'full_name', p.full_name,
        'role', p.role,
        'avatar_url', p.avatar_url,
        'created_at', p.created_at,
        'total_count', COUNT(*) OVER()
      ) AS row_data,
      p.created_at
      FROM public.profiles p
      WHERE p.onboarding_completed = true
        AND p.is_blocked = false
        AND p.is_test_account = false
        AND p.%I = $1
        AND ($2 IS NULL OR p.role = $2)
        AND ($3 IS NULL OR (
          p.email ILIKE '%%' || $3 || '%%'
          OR p.full_name ILIKE '%%' || $3 || '%%'
        ))
      LIMIT $4
      OFFSET $5
    ) sub
    $q$,
    p_preference
  )
  INTO v_result
  USING p_enabled, p_role, p_search, p_limit, p_offset;

  RETURN v_result;
END;
$$;
