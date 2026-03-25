-- Fix: Move block check from RLS INSERT policy to trigger.
-- RLS subqueries against other tables cause PostgreSQL error 42P10
-- with generated-column unique indexes on profile_friendships.

-- Restore original INSERT policy (no block subquery)
DROP POLICY IF EXISTS "friendships insert" ON public.profile_friendships;
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

-- Enforce block check in the trigger instead
CREATE OR REPLACE FUNCTION public.handle_friendship_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  actor_role TEXT := auth.role();
BEGIN
  IF NEW.user_one = NEW.user_two THEN
    RAISE EXCEPTION 'Cannot create friendship with yourself';
  END IF;

  IF NEW.requester_id IS NULL OR (NEW.requester_id <> NEW.user_one AND NEW.requester_id <> NEW.user_two) THEN
    RAISE EXCEPTION 'Requester must be part of the friendship';
  END IF;

  -- Block check: prevent friendships between blocked users
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status = 'pending') THEN
    IF EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = NEW.user_one AND blocked_id = NEW.user_two)
         OR (blocker_id = NEW.user_two AND blocked_id = NEW.user_one)
    ) THEN
      RAISE EXCEPTION 'Cannot interact with this user.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF actor_role <> 'service_role' THEN
      IF actor_id IS NULL OR (actor_id <> OLD.user_one AND actor_id <> OLD.user_two) THEN
        RAISE EXCEPTION 'Only friendship participants can update the relationship';
      END IF;

      IF NEW.status = 'pending' AND OLD.status IN ('cancelled', 'rejected') THEN
        IF NEW.requester_id <> actor_id THEN
          RAISE EXCEPTION 'Only the new requester can re-initiate a friendship';
        END IF;
        NEW.created_at := timezone('utc', now());
      ELSE
        IF NEW.user_one <> OLD.user_one OR NEW.user_two <> OLD.user_two THEN
          RAISE EXCEPTION 'Friendship participants are immutable';
        END IF;
        IF NEW.requester_id <> OLD.requester_id THEN
          RAISE EXCEPTION 'Requester cannot be changed';
        END IF;
      END IF;

      IF NEW.status = 'accepted' THEN
        IF OLD.status <> 'pending' THEN
          RAISE EXCEPTION 'Only pending friendships can be accepted';
        END IF;
        IF actor_id = OLD.requester_id THEN
          RAISE EXCEPTION 'Requester cannot accept their own friendship request';
        END IF;
      END IF;

      IF NEW.status = 'cancelled' AND actor_id <> OLD.requester_id THEN
        RAISE EXCEPTION 'Only the requester can cancel a friendship request';
      END IF;

      IF NEW.status = 'rejected' AND actor_id = OLD.requester_id THEN
        RAISE EXCEPTION 'Requester cannot reject their own friendship request';
      END IF;

      IF NEW.status = 'pending' AND OLD.status NOT IN ('cancelled', 'rejected') THEN
        RAISE EXCEPTION 'Cannot revert to pending from this state';
      END IF;
    END IF;
  END IF;

  IF NEW.status = 'accepted' THEN
    IF NEW.accepted_at IS NULL THEN
      NEW.accepted_at := timezone('utc', now());
    END IF;
  ELSE
    NEW.accepted_at := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, timezone('utc', now()));
  END IF;

  RETURN NEW;
END;
$$;
