-- Application response loop — schema batch (behavior-neutral, deploy-dark).
--
-- Ships the data foundations for the three response-loop features BEFORE any
-- of them runs, because ordering is load-bearing: if the expiry sweep ever
-- writes a status change without an attribution marker, those history rows
-- are permanently indistinguishable from publisher actions and the Task 2
-- responsiveness metric can never exclude them retroactively.
--
-- Contents:
--   1. application_status_history.changed_via + trigger passthrough
--   2. email_action_tokens (single-use, hashed, expiring digest-action tokens)
--   3. application_response_settings (typed single-row config; sweep/digest
--      are DISARMED by default — arming prod is an explicit UPDATE, never an
--      implicit now() at deploy time)
--   4. enqueue_notification hardening (EXECUTE was granted to PUBLIC — the
--      Postgres default for functions — letting any authenticated or anon
--      client forge arbitrary notifications; pre-existing exposure closed
--      here while we touch this surface)

-- ────────────────────────────────────────────────────────────────────
-- 1. changed_via on application_status_history
-- ────────────────────────────────────────────────────────────────────
-- NULL = in-app triage (the ApplicantsList update never sets it, so existing
-- behavior is untouched). The email-action endpoint and the expiry sweep pass
-- it inside the SAME update that changes status (metadata.changed_via), which
-- is the only write the history trigger can see.
ALTER TABLE public.application_status_history
  ADD COLUMN IF NOT EXISTS changed_via text
  CHECK (changed_via IN ('email_action', 'auto_expiry'));

CREATE OR REPLACE FUNCTION public.record_application_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_club_id uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT o.club_id INTO v_club_id FROM public.opportunities o WHERE o.id = NEW.opportunity_id;
    INSERT INTO public.application_status_history (application_id, old_status, new_status, reason, changed_by, changed_via)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.metadata->>'status_reason', v_club_id, NEW.metadata->>'changed_via');
  END IF;
  RETURN NEW;
END; $function$;

-- ────────────────────────────────────────────────────────────────────
-- 2. email_action_tokens — one-click triage links in the weekly digest
-- ────────────────────────────────────────────────────────────────────
-- One token per (application, action) button, minted at SEND time (a failed
-- send must not leave live orphan tokens). Raw tokens never touch the DB:
-- only the SHA-256 hash is stored; the link carries the raw value. The
-- endpoint additionally preconditions on the application still being
-- 'pending', so a stale link can never silently overwrite in-app triage.
CREATE TABLE public.email_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  application_id uuid NOT NULL REFERENCES public.opportunity_applications(id) ON DELETE CASCADE,
  -- the exact in-app triage transitions; 'no_response' is the sweep's, never a button
  action public.application_status NOT NULL CHECK (action IN ('shortlisted', 'maybe', 'rejected')),
  publisher_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_email_action_tokens_application ON public.email_action_tokens (application_id);

ALTER TABLE public.email_action_tokens ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service-role token endpoint touches this
-- table. The REVOKE below is the outer fence (RLS is the gate).
REVOKE ALL ON TABLE public.email_action_tokens FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 3. application_response_settings — typed single-row config
-- ────────────────────────────────────────────────────────────────────
-- launch_date is the grandfathering anchor: the sweep clocks every
-- application from GREATEST(applied_at, launch_date), so the pre-launch
-- backlog gets a full window after arming instead of expiring en masse on
-- day one. NULL launch_date (or sweep_enabled=false) hard no-ops the sweep —
-- prod deploys dark and is armed by an explicit UPDATE on launch day.
-- Staging simulates any date by editing this row.
CREATE TABLE public.application_response_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), -- single-row guard
  launch_date timestamptz,
  expiry_days integer NOT NULL DEFAULT 14 CHECK (expiry_days BETWEEN 1 AND 90),
  digest_enabled boolean NOT NULL DEFAULT false,
  sweep_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

INSERT INTO public.application_response_settings (id) VALUES (true);

ALTER TABLE public.application_response_settings ENABLE ROW LEVEL SECURITY;
-- Readable by everyone: the player UI derives the visible response deadline
-- (GREATEST(applied_at, launch_date) + expiry_days) from this row. Writes are
-- service-role/admin only.
CREATE POLICY "application response settings are readable"
  ON public.application_response_settings FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.application_response_settings FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 4. enqueue_notification hardening
-- ────────────────────────────────────────────────────────────────────
-- Verified before this migration: zero direct client/edge callers exist; all
-- legitimate callers are SECURITY DEFINER trigger functions, which execute as
-- the function owner and are unaffected by these revokes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enqueue_notification'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
