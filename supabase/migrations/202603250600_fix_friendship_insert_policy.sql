-- Fix: Replace is_blocked_pair() function call in friendship INSERT policy
-- with inline NOT EXISTS to avoid PostgreSQL SECURITY DEFINER context switch
-- that causes "no unique or exclusion constraint matching ON CONFLICT" errors.

DROP POLICY IF EXISTS "friendships insert" ON public.profile_friendships;
CREATE POLICY "friendships insert"
  ON public.profile_friendships FOR INSERT
  WITH CHECK (
    auth.role() = 'service_role'
    OR (
      auth.uid() = requester_id
      AND (auth.uid() = user_one OR auth.uid() = user_two)
      AND status = 'pending'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
        WHERE (ub.blocker_id = user_one AND ub.blocked_id = user_two)
           OR (ub.blocker_id = user_two AND ub.blocked_id = user_one)
      )
    )
  );
