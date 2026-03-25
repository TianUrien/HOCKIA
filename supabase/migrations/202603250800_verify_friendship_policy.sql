-- Verify and force-recreate the friendship INSERT policy
-- to eliminate any cached/stale policy state.

-- Drop ALL possible friendship insert policies
DROP POLICY IF EXISTS "friendships insert" ON public.profile_friendships;
DROP POLICY IF EXISTS "friendships_insert" ON public.profile_friendships;
DROP POLICY IF EXISTS "Users can create friendships" ON public.profile_friendships;

-- Recreate the clean policy (matches the original from 202511141930)
CREATE POLICY "friendships insert"
  ON public.profile_friendships FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      auth.uid() = requester_id
      AND (auth.uid() = user_one OR auth.uid() = user_two)
      AND status = 'pending'
    )
  );
