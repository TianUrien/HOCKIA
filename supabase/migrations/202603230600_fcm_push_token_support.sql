-- =============================================================================
-- FCM Push Token Support
-- =============================================================================
-- Adds native FCM token storage alongside existing Web Push (VAPID) subscriptions.
-- Native apps (iOS/Android via Capacitor) register an FCM token instead of
-- VAPID endpoint+keys. The send-push edge function checks which type of
-- subscription it is and dispatches accordingly.
-- =============================================================================

-- Add columns for FCM token and platform detection
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS fcm_token TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'web';

-- Make VAPID fields nullable (native subscriptions won't have them)
ALTER TABLE push_subscriptions
  ALTER COLUMN endpoint DROP NOT NULL,
  ALTER COLUMN p256dh DROP NOT NULL,
  ALTER COLUMN auth DROP NOT NULL;

-- Unique constraint on FCM token per user (prevents duplicate registrations)
DO $$ BEGIN
  ALTER TABLE push_subscriptions
    ADD CONSTRAINT push_subscriptions_profile_fcm_unique
    UNIQUE (profile_id, fcm_token);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for quick lookup by FCM token
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_fcm_token
  ON push_subscriptions (fcm_token)
  WHERE fcm_token IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN push_subscriptions.fcm_token IS 'Firebase Cloud Messaging device token for native iOS/Android push';
COMMENT ON COLUMN push_subscriptions.platform IS 'Device platform: web, ios, or android';
