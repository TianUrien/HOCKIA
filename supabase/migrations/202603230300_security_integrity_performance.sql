-- ============================================================================
-- Security, data integrity, and performance improvements
-- ============================================================================

-- ============================================================================
-- P0: Restrict message UPDATE to only allow read_at changes
-- Prevents recipients from modifying message content or sender_id.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_message_update_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only read_at is allowed to change
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    RAISE EXCEPTION 'Message content is immutable';
  END IF;

  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'Message sender is immutable';
  END IF;

  IF NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
    RAISE EXCEPTION 'Message conversation is immutable';
  END IF;

  IF NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
    RAISE EXCEPTION 'Message timestamp is immutable';
  END IF;

  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'Message idempotency key is immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_message_immutability ON public.messages;
CREATE TRIGGER enforce_message_immutability
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_message_update_immutability();

-- ============================================================================
-- P2: Revoke references when friendship is deleted or blocked
-- If friendship changes to blocked/cancelled/rejected or is deleted,
-- revoke any accepted references between those two users.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.revoke_references_on_friendship_end()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_a UUID;
  v_user_b UUID;
  v_revoked INT;
BEGIN
  -- On DELETE: use OLD values
  IF TG_OP = 'DELETE' THEN
    v_user_a := OLD.user_one;
    v_user_b := OLD.user_two;
  -- On UPDATE to blocked/cancelled/rejected: use NEW values
  ELSIF TG_OP = 'UPDATE' AND NEW.status IN ('blocked', 'cancelled', 'rejected') THEN
    v_user_a := NEW.user_one;
    v_user_b := NEW.user_two;
  ELSE
    -- No action for other transitions
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Revoke accepted references in both directions and update counts per-user.
  -- Each user's count decrements only by references where THEY are the requester.

  -- Revoke A→B direction
  UPDATE profile_references
  SET status = 'revoked', revoked_at = now()
  WHERE status = 'accepted'
    AND requester_id = v_user_a AND reference_id = v_user_b;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;
  IF v_revoked > 0 THEN
    UPDATE profiles
    SET accepted_reference_count = GREATEST(0, COALESCE(accepted_reference_count, 0) - v_revoked)
    WHERE id = v_user_a;
  END IF;

  -- Revoke B→A direction
  v_revoked := 0;
  UPDATE profile_references
  SET status = 'revoked', revoked_at = now()
  WHERE status = 'accepted'
    AND requester_id = v_user_b AND reference_id = v_user_a;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;
  IF v_revoked > 0 THEN
    UPDATE profiles
    SET accepted_reference_count = GREATEST(0, COALESCE(accepted_reference_count, 0) - v_revoked)
    WHERE id = v_user_b;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS revoke_references_on_friendship_end ON public.profile_friendships;
CREATE TRIGGER revoke_references_on_friendship_end
  AFTER UPDATE OF status OR DELETE ON public.profile_friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.revoke_references_on_friendship_end();

-- ============================================================================
-- P2: Backfill coach position field
-- Existing coaches have "head coach"/"assistant coach"/"youth coach" in the
-- position column. Migrate these to coach_specialization if not already set,
-- then clear the position field for coaches.
-- ============================================================================
UPDATE profiles
SET coach_specialization = CASE
      WHEN lower(trim(position)) IN ('head coach', 'head_coach') THEN 'head_coach'
      WHEN lower(trim(position)) IN ('assistant coach', 'assistant_coach') THEN 'assistant_coach'
      WHEN lower(trim(position)) IN ('youth coach', 'youth_coach') THEN 'youth_coach'
      ELSE NULL
    END,
    position = NULL
WHERE role = 'coach'
  AND position IS NOT NULL
  AND position != ''
  AND (coach_specialization IS NULL OR coach_specialization = '');

-- Also clear position for coaches who already have a specialization
UPDATE profiles
SET position = NULL
WHERE role = 'coach'
  AND position IS NOT NULL
  AND position != ''
  AND coach_specialization IS NOT NULL;

-- ============================================================================
-- P3: Add composite indexes for conversation list queries
-- Currently queries use OR on participant_one_id/participant_two_id with no
-- covering index, causing sequential scans at scale.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_conversations_participant_one_last_msg
  ON public.conversations (participant_one_id, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_conversations_participant_two_last_msg
  ON public.conversations (participant_two_id, last_message_at DESC NULLS LAST);

-- ============================================================================
-- P3: Event and error log retention
-- Prune events older than 90 days and error_logs older than 90 days.
-- Runs daily at 03:00 UTC via pg_cron.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prune_old_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_events_deleted BIGINT;
  v_errors_deleted BIGINT;
BEGIN
  DELETE FROM events
  WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

  DELETE FROM error_logs
  WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_errors_deleted = ROW_COUNT;

  IF v_events_deleted > 0 OR v_errors_deleted > 0 THEN
    RAISE LOG 'prune_old_logs: deleted % events, % error_logs', v_events_deleted, v_errors_deleted;
  END IF;
END;
$$;

-- Schedule the cleanup job (idempotent: unschedule first if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-old-logs') THEN
    PERFORM cron.unschedule('prune-old-logs');
  END IF;
  PERFORM cron.schedule(
    'prune-old-logs',
    '0 3 * * *',
    'SELECT public.prune_old_logs()'
  );
END $$;
