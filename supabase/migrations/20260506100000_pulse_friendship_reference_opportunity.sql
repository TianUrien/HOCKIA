-- =========================================================================
-- L1 — Reference opportunity Pulse card
-- =========================================================================
-- When a friendship is accepted, fire a Pulse card on the side(s) whose
-- role is player / coach / umpire — only roles that collect references —
-- prompting them to ask the new friend for a vouch.
--
-- Mirrors the celebrate_first_reference trigger pattern but on the
-- profile_friendships table. Each acceptance can produce up to 2 cards
-- (one per side) when both sides are in the eligible role set.
--
-- Eligibility (per side, evaluated independently):
--   - The side's role is in ('player', 'coach', 'umpire')
--   - The side is not a test account
--   - The OTHER side is not blocked or test
--   - There is no active reference pair (pending or accepted) FROM this
--     side TO the other (we don't prompt re-asks)
--   - This side hasn't received any Pulse card of this type in the
--     last 7 days (frequency cap via _insert_pulse_item)
--
-- Card metadata: { friend_id, friend_name, friend_role, friend_avatar_url }
-- Frontend uses friend_id to deep-link the reference flow with the
-- friend pre-selected, and to coordinate dismissal with
-- RecentlyConnectedCard via a small shared-state hook.
-- =========================================================================

SET search_path = public;

CREATE OR REPLACE FUNCTION public.fire_friendship_reference_pulse()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eligible_roles TEXT[] := ARRAY['player', 'coach', 'umpire'];
  v_side_one_role TEXT;
  v_side_two_role TEXT;
  v_side_one_test BOOLEAN;
  v_side_two_test BOOLEAN;
  v_side_one_name TEXT;
  v_side_two_name TEXT;
  v_side_one_avatar TEXT;
  v_side_two_avatar TEXT;
  v_blocked BOOLEAN;
BEGIN
  -- Only fire when status transitions to accepted (not on every UPDATE).
  IF NEW.status != 'accepted' OR OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  -- Pull both profiles in one shot.
  SELECT role, COALESCE(is_test_account, false), full_name, avatar_url
    INTO v_side_one_role, v_side_one_test, v_side_one_name, v_side_one_avatar
    FROM public.profiles WHERE id = NEW.user_one;

  SELECT role, COALESCE(is_test_account, false), full_name, avatar_url
    INTO v_side_two_role, v_side_two_test, v_side_two_name, v_side_two_avatar
    FROM public.profiles WHERE id = NEW.user_two;

  -- Defensive: bail if either profile lookup failed.
  IF v_side_one_role IS NULL OR v_side_two_role IS NULL THEN
    RETURN NEW;
  END IF;

  -- Block check — if either side has blocked the other, no prompt.
  -- user_blocks is bidirectional in lookups.
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
     WHERE (blocker_id = NEW.user_one AND blocked_id = NEW.user_two)
        OR (blocker_id = NEW.user_two AND blocked_id = NEW.user_one)
  ) INTO v_blocked;
  IF v_blocked THEN
    RETURN NEW;
  END IF;

  -- Side one: prompt user_one to ask user_two for a vouch.
  IF v_side_one_role = ANY(v_eligible_roles)
     AND NOT v_side_one_test
     AND NOT v_side_two_test
     AND v_side_two_name IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.profile_references
        WHERE requester_id = NEW.user_one
          AND reference_id = NEW.user_two
          AND status IN ('pending', 'accepted')
     )
  THEN
    PERFORM public._insert_pulse_item(
      NEW.user_one,
      'friendship_reference_opportunity',
      2::SMALLINT,
      jsonb_build_object(
        'friend_id', NEW.user_two,
        'friend_name', v_side_two_name,
        'friend_role', v_side_two_role,
        'friend_avatar_url', v_side_two_avatar
      ),
      7
    );
  END IF;

  -- Side two: prompt user_two to ask user_one for a vouch.
  IF v_side_two_role = ANY(v_eligible_roles)
     AND NOT v_side_two_test
     AND NOT v_side_one_test
     AND v_side_one_name IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.profile_references
        WHERE requester_id = NEW.user_two
          AND reference_id = NEW.user_one
          AND status IN ('pending', 'accepted')
     )
  THEN
    PERFORM public._insert_pulse_item(
      NEW.user_two,
      'friendship_reference_opportunity',
      2::SMALLINT,
      jsonb_build_object(
        'friend_id', NEW.user_one,
        'friend_name', v_side_one_name,
        'friend_role', v_side_one_role,
        'friend_avatar_url', v_side_one_avatar
      ),
      7
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_fire_friendship_reference_pulse ON public.profile_friendships;
CREATE TRIGGER trigger_fire_friendship_reference_pulse
  AFTER UPDATE ON public.profile_friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.fire_friendship_reference_pulse();

-- Hygiene: same revoke pattern as the celebrate_* trigger functions.
-- Triggers are only invoked via the table event in normal operation, but
-- removing PUBLIC EXECUTE is defense-in-depth.
REVOKE EXECUTE ON FUNCTION public.fire_friendship_reference_pulse() FROM PUBLIC;

COMMENT ON FUNCTION public.fire_friendship_reference_pulse IS
  'Inserts a friendship_reference_opportunity Pulse card on each eligible side of a newly-accepted friendship. Eligibility: side role in player/coach/umpire, neither side is a test account, no active reference pair already exists, and 7-day per-user frequency cap.';
