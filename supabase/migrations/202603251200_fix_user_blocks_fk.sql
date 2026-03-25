-- Test fix: Change user_blocks FK from profiles to auth.users
-- to avoid PostgREST schema ambiguity with profile_friendships
-- (both tables referencing profiles with unique constraints on UUIDs)

ALTER TABLE public.user_blocks
  DROP CONSTRAINT IF EXISTS user_blocks_blocked_id_fkey;

ALTER TABLE public.user_blocks
  ADD CONSTRAINT user_blocks_blocked_id_fkey
  FOREIGN KEY (blocked_id) REFERENCES auth.users(id) ON DELETE CASCADE;
