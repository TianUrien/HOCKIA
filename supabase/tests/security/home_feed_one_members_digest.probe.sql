-- READ-ONLY probe for 20261124100000_home_feed_one_members_digest.sql.
-- As the oldest onboarded member: a deep page of Home holds at most one
-- "joined this week" card, and it is the newest digest row.
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM profiles WHERE onboarding_completed AND NOT COALESCE(is_blocked, false) AND frozen_minor_at IS NULL ORDER BY created_at LIMIT 1), 'role', 'authenticated')::text, true);
WITH feed AS (
  SELECT jsonb_array_elements(public.get_home_feed_v2(200, 0, true)->'items') AS it
), digests AS (
  SELECT it->>'feed_item_id' AS id FROM feed WHERE it->>'item_type' = 'members_digest'
)
SELECT CASE WHEN (SELECT count(*) FROM digests) <= 1 THEN 'PASS' ELSE 'FAIL' END AS status, 'Home returns at most one members digest' AS chk
UNION ALL
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM digests d WHERE d.id <> (SELECT x.id::text FROM home_feed_items x WHERE x.item_type = 'members_digest' AND x.deleted_at IS NULL ORDER BY x.created_at DESC, x.id DESC LIMIT 1)) THEN 'PASS' ELSE 'FAIL' END, 'the digest shown is the newest one'
UNION ALL
SELECT CASE WHEN has_function_privilege('authenticated', 'public.get_home_feed_v2(integer,integer,boolean)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END, 'members can still read Home';
