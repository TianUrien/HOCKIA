-- Admin dashboards (Overview / Engagement charts, 2026-10-15): one daily
-- series of what members actually did — messages, conversations started,
-- applications, roles posted, friendships made, posts — so the admin can draw
-- them as bars and lines instead of reading single totals. Test accounts are
-- left out, like admin_get_signup_trends. Admin-gated like every admin_* RPC.
CREATE OR REPLACE FUNCTION public.admin_get_activity_series(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  day DATE,
  messages BIGINT,
  conversations BIGINT,
  applications BIGINT,
  opportunities BIGINT,
  friendships BIGINT,
  posts BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT d::DATE AS day
    FROM generate_series(
      (now() - (GREATEST(1, LEAST(p_days, 365)) - 1 || ' days')::INTERVAL)::DATE,
      now()::DATE,
      '1 day'::INTERVAL
    ) AS d
  ),
  test_accounts AS (
    SELECT id FROM profiles WHERE is_test_account
  )
  SELECT
    days.day,
    (SELECT count(*) FROM messages m
       WHERE m.sent_at::DATE = days.day AND m.deleted_at IS NULL
         AND m.sender_id NOT IN (SELECT id FROM test_accounts)) AS messages,
    (SELECT count(*) FROM conversations c
       WHERE c.created_at::DATE = days.day
         AND c.participant_one_id NOT IN (SELECT id FROM test_accounts)
         AND c.participant_two_id NOT IN (SELECT id FROM test_accounts)) AS conversations,
    (SELECT count(*) FROM opportunity_applications a
       WHERE a.applied_at::DATE = days.day
         AND a.applicant_id NOT IN (SELECT id FROM test_accounts)) AS applications,
    (SELECT count(*) FROM opportunities o
       WHERE o.created_at::DATE = days.day
         AND o.club_id NOT IN (SELECT id FROM test_accounts)) AS opportunities,
    (SELECT count(*) FROM profile_friendships f
       WHERE f.status = 'accepted' AND f.accepted_at::DATE = days.day
         AND f.user_one NOT IN (SELECT id FROM test_accounts)
         AND f.user_two NOT IN (SELECT id FROM test_accounts)) AS friendships,
    (SELECT count(*) FROM user_posts up
       WHERE up.created_at::DATE = days.day AND up.deleted_at IS NULL
         AND up.author_id NOT IN (SELECT id FROM test_accounts)) AS posts
  FROM days
  ORDER BY days.day;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_activity_series(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_activity_series(integer) TO authenticated;
