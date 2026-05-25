-- Phase 3 follow-up — align admin_get_dashboard_stats's `total_brands`
-- with how Players/Coaches/Clubs are counted. Caught by the QA agent's
-- 2nd pass (2026-05-25): Overview tile said "Brands 0" while Investors
-- and Feature Usage both said "Brands 2" — three surfaces using three
-- different definitions for the same noun.
--
-- The old definition counted `brands` ROWS where deleted_at IS NULL AND
-- owner profile is non-test. On staging this returns 0 because the
-- single brands row was created by a test account. But the other surfaces
-- (Investors, Feature Usage Views by Role) count `profiles WHERE role
-- = 'brand' AND NOT is_test_account`, returning 2.
--
-- Decision: align `total_brands` with the profile-based count to match
-- the Users section's "Players/Coaches/Clubs/Brands" framing — those
-- tiles are all about ROLE-BASED ACCOUNTS, not entities. The brand
-- entity counts (rows in the brands table) move to a new
-- `total_brand_entities` field so the data is still available where
-- entity counts matter (e.g. marketplace counters).
--
-- The brands_7d / total_brand_products / total_brand_posts fields keep
-- their existing entity-based definitions — those are explicitly about
-- brand activity, not brand-role account counts.

SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_get_dashboard_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stats JSON;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT json_build_object(
    'total_users', (SELECT COUNT(*) FROM profiles WHERE NOT is_test_account),
    'total_players', (SELECT COUNT(*) FROM profiles WHERE role = 'player' AND NOT is_test_account),
    'total_coaches', (SELECT COUNT(*) FROM profiles WHERE role = 'coach' AND NOT is_test_account),
    'total_clubs', (SELECT COUNT(*) FROM profiles WHERE role = 'club' AND NOT is_test_account),
    'blocked_users', (SELECT COUNT(*) FROM profiles WHERE is_blocked = true),
    'test_accounts', (SELECT COUNT(*) FROM profiles WHERE is_test_account = true),

    -- Phase 3 QA fix: align with Players/Coaches/Clubs (role-based
    -- profile count). Previously counted brand-entity rows; that
    -- definition diverged from Investors + Feature Usage + the rest
    -- of the role-based reporting. Entity count moves to
    -- total_brand_entities below.
    'total_brands', (
      SELECT COUNT(*) FROM profiles WHERE role = 'brand' AND NOT is_test_account
    ),
    'total_brand_entities', (
      SELECT COUNT(*) FROM brands b
      JOIN profiles p ON p.id = b.profile_id
      WHERE b.deleted_at IS NULL AND NOT p.is_test_account
    ),
    'brands_7d', (
      SELECT COUNT(*) FROM brands b
      JOIN profiles p ON p.id = b.profile_id
      WHERE b.created_at > now() - interval '7 days'
        AND b.deleted_at IS NULL
        AND NOT p.is_test_account
    ),
    'total_brand_products', (
      SELECT COUNT(*) FROM brand_products bp
      JOIN brands b ON b.id = bp.brand_id
      JOIN profiles p ON p.id = b.profile_id
      WHERE bp.deleted_at IS NULL
        AND b.deleted_at IS NULL
        AND NOT p.is_test_account
    ),
    'total_brand_posts', (
      SELECT COUNT(*) FROM brand_posts bpost
      JOIN brands b ON b.id = bpost.brand_id
      JOIN profiles p ON p.id = b.profile_id
      WHERE bpost.deleted_at IS NULL
        AND b.deleted_at IS NULL
        AND NOT p.is_test_account
    ),

    'signups_7d', (SELECT COUNT(*) FROM profiles WHERE created_at > now() - interval '7 days' AND NOT is_test_account),
    'signups_30d', (SELECT COUNT(*) FROM profiles WHERE created_at > now() - interval '30 days' AND NOT is_test_account),
    'onboarding_completed', (SELECT COUNT(*) FROM profiles WHERE onboarding_completed = true AND NOT is_test_account),
    'onboarding_pending', (SELECT COUNT(*) FROM profiles WHERE onboarding_completed = false AND NOT is_test_account),
    'total_vacancies', (
      SELECT COUNT(*) FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE NOT p.is_test_account
    ),
    'open_vacancies', (
      SELECT COUNT(*) FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE o.status = 'open' AND NOT p.is_test_account
    ),
    'closed_vacancies', (
      SELECT COUNT(*) FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE o.status = 'closed' AND NOT p.is_test_account
    ),
    'draft_vacancies', (
      SELECT COUNT(*) FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE o.status = 'draft' AND NOT p.is_test_account
    ),
    'vacancies_7d', (
      SELECT COUNT(*) FROM opportunities o
      JOIN profiles p ON p.id = o.club_id
      WHERE o.created_at > now() - interval '7 days'
        AND NOT p.is_test_account
    ),
    'total_applications', (
      SELECT COUNT(*) FROM opportunity_applications oa
      JOIN profiles applicant ON applicant.id = oa.applicant_id
      JOIN opportunities o ON o.id = oa.opportunity_id
      JOIN profiles club ON club.id = o.club_id
      WHERE NOT applicant.is_test_account AND NOT club.is_test_account
    ),
    'pending_applications', (
      SELECT COUNT(*) FROM opportunity_applications oa
      JOIN profiles applicant ON applicant.id = oa.applicant_id
      JOIN opportunities o ON o.id = oa.opportunity_id
      JOIN profiles club ON club.id = o.club_id
      WHERE oa.status = 'pending'
        AND NOT applicant.is_test_account
        AND NOT club.is_test_account
    ),
    'applications_7d', (
      SELECT COUNT(*) FROM opportunity_applications oa
      JOIN profiles applicant ON applicant.id = oa.applicant_id
      JOIN opportunities o ON o.id = oa.opportunity_id
      JOIN profiles club ON club.id = o.club_id
      WHERE oa.applied_at > now() - interval '7 days'
        AND NOT applicant.is_test_account
        AND NOT club.is_test_account
    ),
    'total_conversations', (
      SELECT COUNT(*) FROM conversations c
      JOIN profiles p1 ON p1.id = c.participant_one_id
      JOIN profiles p2 ON p2.id = c.participant_two_id
      WHERE NOT p1.is_test_account AND NOT p2.is_test_account
    ),
    'total_messages', (
      SELECT COUNT(*) FROM messages m
      JOIN profiles p ON p.id = m.sender_id
      WHERE NOT p.is_test_account
    ),
    'messages_7d', (
      SELECT COUNT(*) FROM messages m
      JOIN profiles p ON p.id = m.sender_id
      WHERE m.sent_at > now() - interval '7 days'
        AND NOT p.is_test_account
    ),
    'total_friendships', (
      SELECT COUNT(*) FROM profile_friendships f
      JOIN profiles p1 ON p1.id = f.user_one
      JOIN profiles p2 ON p2.id = f.user_two
      WHERE f.status = 'accepted'
        AND NOT p1.is_test_account
        AND NOT p2.is_test_account
    ),
    'auth_orphans', (
      SELECT COUNT(*) FROM auth.users au
      LEFT JOIN profiles p ON p.id = au.id
      WHERE p.id IS NULL
    ),
    'profile_orphans', (
      SELECT COUNT(*) FROM profiles p
      LEFT JOIN auth.users au ON au.id = p.id
      WHERE au.id IS NULL
    ),
    'push_subscribers', (
      SELECT COUNT(DISTINCT ps.profile_id)
      FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE NOT p.is_test_account
    ),
    'push_subscribers_player', (
      SELECT COUNT(DISTINCT ps.profile_id) FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'player' AND NOT p.is_test_account
    ),
    'push_subscribers_coach', (
      SELECT COUNT(DISTINCT ps.profile_id) FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'coach' AND NOT p.is_test_account
    ),
    'push_subscribers_club', (
      SELECT COUNT(DISTINCT ps.profile_id) FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'club' AND NOT p.is_test_account
    ),
    'push_subscribers_brand', (
      SELECT COUNT(DISTINCT ps.profile_id) FROM push_subscriptions ps
      JOIN profiles p ON p.id = ps.profile_id
      WHERE p.role = 'brand' AND NOT p.is_test_account
    ),
    'pwa_installs', (SELECT COUNT(*) FROM pwa_installs),
    'pwa_installs_ios', (SELECT COUNT(*) FROM pwa_installs WHERE platform = 'ios'),
    'pwa_installs_android', (SELECT COUNT(*) FROM pwa_installs WHERE platform = 'android'),
    'pwa_installs_desktop', (SELECT COUNT(*) FROM pwa_installs WHERE platform = 'desktop'),
    'device_users_ios', (
      SELECT COUNT(DISTINCT ud.profile_id) FROM user_devices ud
      JOIN profiles p ON p.id = ud.profile_id
      WHERE ud.platform = 'ios' AND NOT p.is_test_account
    ),
    'device_users_android', (
      SELECT COUNT(DISTINCT ud.profile_id) FROM user_devices ud
      JOIN profiles p ON p.id = ud.profile_id
      WHERE ud.platform = 'android' AND NOT p.is_test_account
    ),
    'device_users_desktop', (
      SELECT COUNT(DISTINCT ud.profile_id) FROM user_devices ud
      JOIN profiles p ON p.id = ud.profile_id
      WHERE ud.platform = 'desktop' AND NOT p.is_test_account
    ),
    'device_users_pwa', (
      SELECT COUNT(DISTINCT ud.profile_id) FROM user_devices ud
      JOIN profiles p ON p.id = ud.profile_id
      WHERE ud.is_pwa = true AND NOT p.is_test_account
    ),
    'device_users_multi_platform', (
      SELECT COUNT(*) FROM (
        SELECT ud.profile_id FROM user_devices ud
        JOIN profiles p ON p.id = ud.profile_id
        WHERE NOT p.is_test_account
        GROUP BY ud.profile_id HAVING COUNT(*) > 1
      ) mp
    ),
    'generated_at', now()
  ) INTO v_stats;

  RETURN v_stats;
END;
$function$;

NOTIFY pgrst, 'reload schema';
