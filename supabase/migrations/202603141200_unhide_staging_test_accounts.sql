-- Make staging test accounts visible (behave like normal users)
-- These accounts only exist on staging, so this is a no-op on production.
-- They remain identifiable by email but are no longer filtered out by
-- is_test_account checks in RLS, RPCs, feeds, search, discovery, etc.

UPDATE profiles
SET is_test_account = false
WHERE email IN (
  'playrplayer93@gmail.com',
  'clubplayr8@gmail.com',
  'coachplayr@gmail.com',
  'brandplayr@gmail.com'
);
