-- Block enforcement on friendships (Apple Guideline 1.2 / audit P2b).
--
-- When A blocks B, block_user() DELETEs the existing friendship — but nothing
-- stopped a NEW pending friendship being created afterward. The block check was
-- deliberately removed from handle_friendship_state (202603250900) and from the
-- friendships INSERT RLS (202603251100) with the note "handled by block_user which
-- deletes existing friendships on block" — but that only covers block-TIME, not a
-- later re-request. The SEND path is a DIRECT table write
-- (client/src/hooks/useFriendship.ts -> supabase.from('profile_friendships').upsert)
-- with no RPC, so a blocked user could POST a pending row that surfaces in the
-- victim's Friends tab, and an accepted request re-establishes the severed link.
--
-- Same hole + same fix that 20260610100100 applied to messages/conversations:
-- a SECURITY DEFINER BEFORE INSERT OR UPDATE trigger (so it reads user_blocks
-- regardless of the caller's RLS). NOT in the INSERT RLS WITH CHECK — that path
-- caused the original 42P10 error with the generated-column unique index (the
-- reason the block check was reverted from RLS in the first place).

CREATE OR REPLACE FUNCTION public.enforce_friendship_not_blocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- A blocked pair (either direction) must not (re)establish a friendship. block_user
  -- deletes any existing row on block, so a blocked pair should have no row at all —
  -- any INSERT/UPDATE here between a blocked pair is illegitimate.
  IF EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = NEW.user_one AND blocked_id = NEW.user_two)
       OR (blocker_id = NEW.user_two AND blocked_id = NEW.user_one)
  ) THEN
    RAISE EXCEPTION 'Cannot send a friend request to a user you have blocked or who has blocked you.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_enforce_not_blocked ON public.profile_friendships;
CREATE TRIGGER friendships_enforce_not_blocked
  BEFORE INSERT OR UPDATE ON public.profile_friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_friendship_not_blocked();

-- Backfill: remove pending requests created during the unguarded window that sit
-- between a currently-blocked pair (they'd otherwise linger in the victim's inbox).
DELETE FROM public.profile_friendships f
WHERE f.status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = f.user_one AND b.blocked_id = f.user_two)
       OR (b.blocker_id = f.user_two AND b.blocked_id = f.user_one)
  );
