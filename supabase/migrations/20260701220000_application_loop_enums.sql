-- Application response loop — enum additions (own migration).
--
-- ALTER TYPE ... ADD VALUE may run inside a transaction (PG12+) but the new
-- value is unusable until that transaction commits, and the Supabase CLI wraps
-- each migration file in one transaction — so these MUST live in their own
-- file with zero usage, and every migration that references the new labels
-- comes later. Same mechanic that added 'maybe' (202602190300); do NOT copy
-- the drop/recreate of 202602200200.

-- Task 3b: terminal state for applications the publisher never triaged.
-- The daily sweep (separate wave) transitions overdue 'pending' rows here.
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'no_response';

-- Task 3b: per-player AGGREGATE notification ("N of your applications closed
-- without a response" + suggestions). The sweep enqueues ONE of these per
-- player per run — deliberately NOT wired into the per-row status-change
-- trigger, so a player with several applications expiring the same day (or
-- the launch backlog) never gets N separate notifications.
ALTER TYPE public.profile_notification_kind ADD VALUE IF NOT EXISTS 'applications_expired';
