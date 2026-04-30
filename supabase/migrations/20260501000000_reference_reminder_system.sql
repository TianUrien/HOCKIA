-- ============================================================================
-- Reference Reminder Email System (Phase 3.2)
-- ============================================================================
-- Sends ONE-TIME reminder emails to users who have built up at least one
-- accepted friendship that is now ≥7 days old, but still have zero references
-- (no accepted, no pending). The goal is to convert friend-graph activity
-- into trust-signal activity by surfacing the references feature exactly
-- once at the moment it's actionable.
--
-- Architecture mirrors the onboarding_reminder_system migration:
--   pg_cron (daily) → enqueue_reference_reminders() → reference_reminder_queue
--                                                      ↓ (database webhook on INSERT)
--                                                      notify-reference-reminder edge fn
--                                                      → email via shared sender
--                                                      → marks processed_at
--
-- Idempotency:
--   - UNIQUE(recipient_id) on the queue table — at most one reminder per
--     user, ever (this is a one-time discovery nudge, not a recurring drip).
--   - ON CONFLICT DO NOTHING in the enqueue function so reruns never insert
--     duplicates.
--   - Edge function re-checks every eligibility predicate before sending so
--     a row enqueued at 14:00 UTC that becomes ineligible by the time the
--     webhook fires (user accepted a request in the meantime, etc.) is
--     skipped and marked processed.
--
-- Safety:
--   - Skips test accounts, blocked users, and users without an email.
--   - Honors notify_references = true preference.
--   - Restricted to player / coach / umpire roles (the three roles that can
--     COLLECT references via request_reference RPC).
--   - Requires onboarding_completed.
--   - Picks one suggested friend per user — the most recent friendship
--     ≥7 days old that does not already have an active (pending/accepted)
--     reference pair, and whose profile has a usable display name.
-- ============================================================================

SET search_path = public;

-- ============================================================================
-- A. Create reference_reminder_queue table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reference_reminder_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- The friend the email's CTA will preselect. Captured at enqueue time so
  -- the email is deterministic; if this friendship is severed before the
  -- webhook fires, the edge function falls back to skipping the send (the
  -- card on the dashboard surfaces a fresh candidate next time the user
  -- visits anyway).
  suggested_friend_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  processed_at TIMESTAMPTZ,
  -- One-time per user, ever.
  UNIQUE(recipient_id)
);

COMMENT ON TABLE public.reference_reminder_queue
  IS 'Phase 3.2 — queue for the one-time reference-reminder email. pg_cron inserts; database webhook on INSERT fires the notify-reference-reminder edge function.';

CREATE INDEX IF NOT EXISTS idx_reference_reminder_queue_unprocessed
  ON public.reference_reminder_queue (created_at)
  WHERE processed_at IS NULL;

-- No RLS — accessed only by SECURITY DEFINER function and edge function (service role).

-- ============================================================================
-- B. Create enqueue_reference_reminders() function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_reference_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := timezone('utc', now());
  v_window_start TIMESTAMPTZ := v_now - interval '7 days';
BEGIN
  -- One INSERT statement scoped to a CTE so the eligibility query is
  -- evaluated atomically against current data. Each eligible recipient
  -- contributes at most one row (UNIQUE on recipient_id is the backstop;
  -- the CTE picks one suggested_friend_id deterministically).
  WITH eligible_owner AS (
    SELECT p.id AS recipient_id
    FROM profiles p
    WHERE p.role IN ('player', 'coach', 'umpire')
      AND p.notify_references = true
      AND p.is_test_account = false
      AND p.is_blocked = false
      AND p.email IS NOT NULL
      AND p.onboarding_completed = true
      -- Already received this reminder.
      AND NOT EXISTS (
        SELECT 1 FROM reference_reminder_queue rrq
        WHERE rrq.recipient_id = p.id
      )
      -- Has any active (pending or accepted) reference. We only nudge users
      -- with zero references to avoid feeling spammy / redundant.
      AND NOT EXISTS (
        SELECT 1 FROM profile_references pr
        WHERE pr.requester_id = p.id
          AND pr.status IN ('pending', 'accepted')
      )
      -- Has at least one accepted friend that's been a friend ≥7 days AND
      -- whose profile is usable (has a display name) AND that we don't
      -- already have an active reference pair with. Phrased as EXISTS so
      -- the planner can short-circuit per row.
      AND EXISTS (
        SELECT 1
        FROM profile_friend_edges pfe
        JOIN profiles f ON f.id = pfe.friend_id
        WHERE pfe.profile_id = p.id
          AND pfe.status = 'accepted'
          AND pfe.accepted_at <= v_window_start
          AND COALESCE(NULLIF(btrim(f.full_name), ''), NULLIF(btrim(f.username), '')) IS NOT NULL
          AND f.is_blocked = false
          AND NOT EXISTS (
            SELECT 1 FROM profile_references pr
            WHERE pr.requester_id = p.id
              AND pr.reference_id = pfe.friend_id
              AND pr.status IN ('pending', 'accepted')
          )
      )
  ),
  with_friend AS (
    SELECT
      eo.recipient_id,
      -- Pick the MOST RECENT eligible friendship ≥7 days old. Recent ties
      -- in to the same recency criterion the in-app RecentlyConnectedCard
      -- uses, so the email and the dashboard nudge converge on the same
      -- person where possible.
      (
        SELECT pfe.friend_id
        FROM profile_friend_edges pfe
        JOIN profiles f ON f.id = pfe.friend_id
        WHERE pfe.profile_id = eo.recipient_id
          AND pfe.status = 'accepted'
          AND pfe.accepted_at <= v_window_start
          AND COALESCE(NULLIF(btrim(f.full_name), ''), NULLIF(btrim(f.username), '')) IS NOT NULL
          AND f.is_blocked = false
          AND NOT EXISTS (
            SELECT 1 FROM profile_references pr
            WHERE pr.requester_id = eo.recipient_id
              AND pr.reference_id = pfe.friend_id
              AND pr.status IN ('pending', 'accepted')
          )
        ORDER BY pfe.accepted_at DESC
        LIMIT 1
      ) AS suggested_friend_id
    FROM eligible_owner eo
  )
  INSERT INTO reference_reminder_queue (recipient_id, suggested_friend_id)
  SELECT recipient_id, suggested_friend_id
  FROM with_friend
  WHERE suggested_friend_id IS NOT NULL
  ON CONFLICT (recipient_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.enqueue_reference_reminders()
  IS 'Phase 3.2 — daily cron entry point. Inserts at most one reference_reminder_queue row per eligible user. Idempotent via UNIQUE(recipient_id).';

-- ============================================================================
-- C. Schedule pg_cron job — daily at 14:00 UTC
-- ============================================================================
-- 14:00 UTC = 11:00 ART (founder's timezone, easier to monitor) and 16:00
-- CEST (mid-afternoon for the EU player base — emails arrive while users
-- are awake, not at 03:00).
--
-- 4-hour offset from the onboarding_reminder cron (10:00 UTC) so we don't
-- pile send-side load onto Resend in the same minute window.

SELECT cron.schedule(
  'reference_reminder_emails',
  '0 14 * * *',
  'SELECT public.enqueue_reference_reminders();'
);

-- ============================================================================
-- D. Down-migration sketch (for staging rollback / reference only)
-- ============================================================================
-- To fully revert this feature on an environment:
--   SELECT cron.unschedule('reference_reminder_emails');
--   DROP FUNCTION IF EXISTS public.enqueue_reference_reminders();
--   DROP TABLE IF EXISTS public.reference_reminder_queue;
-- The edge function deploy is removed via:
--   supabase functions delete notify-reference-reminder
-- The database webhook is removed manually in the Supabase dashboard
-- (Database → Webhooks → notify_reference_reminder_on_enqueue → delete).
