-- =============================================================================
-- Admin: List device users with filtering, search, and pagination
--
--   admin_get_device_users(p_platform, p_search, p_limit, p_offset)
--     p_platform: 'ios' | 'android' | 'desktop' | 'pwa' | 'multi' | NULL (all)
--     p_search:   case-insensitive match on name or email
--     p_limit:    pagination size (default 50, max 200)
--     p_offset:   pagination offset (default 0)
--   Returns: JSON { total, results: [...] }
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_device_users(
  p_platform TEXT DEFAULT NULL,
  p_search   TEXT DEFAULT NULL,
  p_limit    INT  DEFAULT 50,
  p_offset   INT  DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit  INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
  v_search TEXT := NULLIF(TRIM(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_results JSON;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Base query: one row per distinct profile matching the platform filter
  WITH matching_profiles AS (
    SELECT DISTINCT p.id
    FROM profiles p
    JOIN user_devices ud ON ud.profile_id = p.id
    WHERE
      CASE
        WHEN p_platform = 'pwa'   THEN ud.is_pwa = true
        WHEN p_platform = 'multi' THEN p.id IN (
          SELECT profile_id FROM user_devices GROUP BY profile_id HAVING COUNT(*) > 1
        )
        WHEN p_platform IN ('ios','android','desktop') THEN ud.platform = p_platform
        ELSE TRUE
      END
      AND (
        v_search IS NULL
        OR p.full_name ILIKE '%' || v_search || '%'
        OR p.email     ILIKE '%' || v_search || '%'
        OR p.username  ILIKE '%' || v_search || '%'
      )
  )
  SELECT COUNT(*) INTO v_total FROM matching_profiles;

  SELECT COALESCE(json_agg(row_data ORDER BY last_seen_at DESC NULLS LAST), '[]'::json)
  INTO v_results
  FROM (
    SELECT
      p.id,
      p.full_name,
      p.email,
      p.username,
      p.role,
      p.avatar_url,
      p.created_at AS signup_date,
      -- Latest last_seen across all devices for this user
      (SELECT MAX(last_seen_at) FROM user_devices WHERE profile_id = p.id) AS last_seen_at,
      -- All platforms this user has used
      (
        SELECT json_agg(json_build_object(
          'platform',     ud.platform,
          'is_pwa',       ud.is_pwa,
          'user_agent',   ud.user_agent,
          'last_seen_at', ud.last_seen_at
        ) ORDER BY ud.last_seen_at DESC)
        FROM user_devices ud
        WHERE ud.profile_id = p.id
      ) AS devices
    FROM profiles p
    WHERE p.id IN (
      SELECT DISTINCT p2.id
      FROM profiles p2
      JOIN user_devices ud2 ON ud2.profile_id = p2.id
      WHERE
        CASE
          WHEN p_platform = 'pwa'   THEN ud2.is_pwa = true
          WHEN p_platform = 'multi' THEN p2.id IN (
            SELECT profile_id FROM user_devices GROUP BY profile_id HAVING COUNT(*) > 1
          )
          WHEN p_platform IN ('ios','android','desktop') THEN ud2.platform = p_platform
          ELSE TRUE
        END
        AND (
          v_search IS NULL
          OR p2.full_name ILIKE '%' || v_search || '%'
          OR p2.email     ILIKE '%' || v_search || '%'
          OR p2.username  ILIKE '%' || v_search || '%'
        )
    )
    ORDER BY (SELECT MAX(last_seen_at) FROM user_devices WHERE profile_id = p.id) DESC NULLS LAST
    LIMIT v_limit
    OFFSET v_offset
  ) row_data;

  RETURN json_build_object(
    'total',   v_total,
    'results', v_results,
    'limit',   v_limit,
    'offset',  v_offset
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_device_users(TEXT, TEXT, INT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
