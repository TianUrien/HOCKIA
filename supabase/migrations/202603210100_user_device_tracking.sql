-- =============================================================================
-- User Device Tracking
--
--   1. user_devices table — tracks platform for ALL logged-in users
--   2. profiles.last_platform column
--   3. track_user_device() RPC — upserts device + updates profile
--   4. RLS policies
--   5. Extend admin_get_dashboard_stats() with device metrics
-- =============================================================================

-- 1. User Devices table
CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'desktop')),
  user_agent TEXT,
  is_pwa BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(profile_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_profile ON user_devices(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_platform ON user_devices(platform);

-- 2. Add last_platform to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_platform TEXT;

-- 3. RPC to track device
CREATE OR REPLACE FUNCTION public.track_user_device(
  p_platform TEXT,
  p_user_agent TEXT DEFAULT NULL,
  p_is_pwa BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO user_devices (profile_id, platform, user_agent, is_pwa, last_seen_at)
  VALUES (v_uid, p_platform, p_user_agent, p_is_pwa, now())
  ON CONFLICT (profile_id, platform)
  DO UPDATE SET
    user_agent = EXCLUDED.user_agent,
    is_pwa = EXCLUDED.is_pwa,
    last_seen_at = now();

  UPDATE profiles SET last_platform = p_platform WHERE id = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_user_device(TEXT, TEXT, BOOLEAN) TO authenticated;

-- 4. RLS
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users track own devices"
  ON user_devices FOR INSERT
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Users update own devices"
  ON user_devices FOR UPDATE
  USING (profile_id = auth.uid());

CREATE POLICY "Users read own devices"
  ON user_devices FOR SELECT
  USING (profile_id = auth.uid());

CREATE POLICY "Admins read all devices"
  ON user_devices FOR SELECT
  USING (public.is_platform_admin());

-- 5. Extend admin_get_dashboard_stats with device metrics
CREATE OR REPLACE FUNCTION public.admin_get_dashboard_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats JSON;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT json_build_object(
    -- User metrics
    'total_users', (SELECT COUNT(*) FROM profiles WHERE NOT is_test_account),
    'total_players', (SELECT COUNT(*) FROM profiles WHERE role = 'player' AND NOT is_test_account),
    'total_coaches', (SELECT COUNT(*) FROM profiles WHERE role = 'coach' AND NOT is_test_account),
    'total_clubs', (SELECT COUNT(*) FROM profiles WHERE role = 'club' AND NOT is_test_account),
    'blocked_users', (SELECT COUNT(*) FROM profiles WHERE is_blocked = true),
    'test_accounts', (SELECT COUNT(*) FROM profiles WHERE is_test_account = true),

    -- Brand metrics
    'total_brands', (SELECT COUNT(*) FROM brands WHERE deleted_at IS NULL),
    'brands_7d', (SELECT COUNT(*) FROM brands WHERE created_at > now() - interval '7 days' AND deleted_at IS NULL),
    'total_brand_products', (SELECT COUNT(*) FROM brand_products WHERE deleted_at IS NULL),
    'total_brand_posts', (SELECT COUNT(*) FROM brand_posts WHERE deleted_at IS NULL),

    -- Signups
    'signups_7d', (SELECT COUNT(*) FROM profiles WHERE created_at > now() - interval '7 days' AND NOT is_test_account),
    'signups_30d', (SELECT COUNT(*) FROM profiles WHERE created_at > now() - interval '30 days' AND NOT is_test_account),

    -- Onboarding
    'onboarding_completed', (SELECT COUNT(*) FROM profiles WHERE onboarding_completed = true AND NOT is_test_account),
    'onboarding_pending', (SELECT COUNT(*) FROM profiles WHERE onboarding_completed = false AND NOT is_test_account),

    -- Content metrics
    'total_vacancies', (SELECT COUNT(*) FROM opportunities),
    'open_vacancies', (SELECT COUNT(*) FROM opportunities WHERE status = 'open'),
    'closed_vacancies', (SELECT COUNT(*) FROM opportunities WHERE status = 'closed'),
    'draft_vacancies', (SELECT COUNT(*) FROM opportunities WHERE status = 'draft'),
    'vacancies_7d', (SELECT COUNT(*) FROM opportunities WHERE created_at > now() - interval '7 days'),

    -- Applications
    'total_applications', (SELECT COUNT(*) FROM opportunity_applications),
    'pending_applications', (SELECT COUNT(*) FROM opportunity_applications WHERE status = 'pending'),
    'applications_7d', (SELECT COUNT(*) FROM opportunity_applications WHERE applied_at > now() - interval '7 days'),

    -- Engagement
    'total_conversations', (SELECT COUNT(*) FROM conversations),
    'total_messages', (SELECT COUNT(*) FROM messages),
    'messages_7d', (SELECT COUNT(*) FROM messages WHERE sent_at > now() - interval '7 days'),
    'total_friendships', (SELECT COUNT(*) FROM profile_friendships WHERE status = 'accepted'),

    -- Data health
    'auth_orphans', (
      SELECT COUNT(*)
      FROM auth.users au
      LEFT JOIN profiles p ON p.id = au.id
      WHERE p.id IS NULL
    ),
    'profile_orphans', (
      SELECT COUNT(*)
      FROM profiles p
      LEFT JOIN auth.users au ON au.id = p.id
      WHERE au.id IS NULL
    ),

    -- Push notification metrics
    'push_subscribers', (SELECT COUNT(DISTINCT profile_id) FROM push_subscriptions),
    'push_subscribers_player', (
      SELECT COUNT(DISTINCT ps.profile_id)
      FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'player' AND NOT p.is_test_account
    ),
    'push_subscribers_coach', (
      SELECT COUNT(DISTINCT ps.profile_id)
      FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'coach' AND NOT p.is_test_account
    ),
    'push_subscribers_club', (
      SELECT COUNT(DISTINCT ps.profile_id)
      FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'club' AND NOT p.is_test_account
    ),
    'push_subscribers_brand', (
      SELECT COUNT(DISTINCT ps.profile_id)
      FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'brand' AND NOT p.is_test_account
    ),

    -- PWA install metrics
    'pwa_installs', (SELECT COUNT(*) FROM pwa_installs),
    'pwa_installs_ios', (SELECT COUNT(*) FROM pwa_installs WHERE platform = 'ios'),
    'pwa_installs_android', (SELECT COUNT(*) FROM pwa_installs WHERE platform = 'android'),
    'pwa_installs_desktop', (SELECT COUNT(*) FROM pwa_installs WHERE platform = 'desktop'),

    -- Device tracking metrics (ALL logged-in users)
    'device_users_ios', (SELECT COUNT(DISTINCT profile_id) FROM user_devices WHERE platform = 'ios'),
    'device_users_android', (SELECT COUNT(DISTINCT profile_id) FROM user_devices WHERE platform = 'android'),
    'device_users_desktop', (SELECT COUNT(DISTINCT profile_id) FROM user_devices WHERE platform = 'desktop'),
    'device_users_pwa', (SELECT COUNT(DISTINCT profile_id) FROM user_devices WHERE is_pwa = true),
    'device_users_multi_platform', (
      SELECT COUNT(*) FROM (
        SELECT profile_id FROM user_devices GROUP BY profile_id HAVING COUNT(*) > 1
      ) mp
    ),

    -- Timestamps
    'generated_at', now()
  ) INTO v_stats;

  RETURN v_stats;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_dashboard_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';
