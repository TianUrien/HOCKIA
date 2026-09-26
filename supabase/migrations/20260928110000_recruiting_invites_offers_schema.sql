-- Track C · step 2 — schema for "Invite to apply" (D3) and "From yes to signed" (D4).
-- Rollback: supabase/rollbacks/20260928110000_recruiting_invites_offers_schema.down.sql
--
-- Founder rulings 2026-09-26 (binding):
--   * New tables have RLS from day one. Clients only READ them; every status change
--     goes through the SECURITY DEFINER functions in 20260928120000.
--   * One open invite per player per CLUB (publisher) at a time; never to under-18s.
--   * Offer terms are visible only to that club and that player.
--   * After signing, the player may hide or delete the career entry but not change its
--     club, season or "Signed through Hockia".
--
-- Grants are explicit on every new object (Supabase stops default ACLs for new objects
-- on 30 Oct 2026): REVOKE ALL FROM PUBLIC, then only what each role needs.
--
-- Contents
--   1. is_minor(uid)
--   2. opportunity_invites
--   3. opportunity_offers (versioned)
--   4. opportunity_applications: invite_id, trial, signing columns
--   5. career_history: signed_via_hockia, signed_at, application_id, is_hidden
--   6. conversations.origin += 'Invitation', 'Application'
--   7. application_status_history.changed_via += 'role_filled', 'recruiting_expiry'
--   8. guard_application_client_write: direct client writes stay in the review states
--   9. invite ↔ application link triggers
--  10. record_application_status_history records the real actor
--  11. career_history guard
--  12. messages: recruiting cards are fixed, and notify through recruiting_update only


-- ─── 1. is_minor ───────────────────────────────────────────────────────────────
-- True when the profile's date of birth says the person is under 18 today.
-- Unknown DOB → false here; callers that need a KNOWN adult (send_invite) also
-- require date_of_birth IS NOT NULL. Not exposed to clients: it would reveal who is
-- a minor. Server functions run as the owner and can call it.

CREATE OR REPLACE FUNCTION public.is_minor(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = p_uid
       AND p.date_of_birth IS NOT NULL
       AND p.date_of_birth > (timezone('utc', now()))::date - interval '18 years'
  );
$$;

REVOKE ALL ON FUNCTION public.is_minor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_minor(uuid) TO service_role;


-- ─── 2. opportunity_invites ────────────────────────────────────────────────────
-- club_id = the publisher (opportunities.club_id): a club, or a coach who recruits.

CREATE TABLE IF NOT EXISTS public.opportunity_invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  club_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note            text,
  status          text NOT NULL DEFAULT 'sent',
  sent_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  expires_at      timestamptz NOT NULL,
  responded_at    timestamptz,
  application_id  uuid REFERENCES public.opportunity_applications(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id      uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  CONSTRAINT opportunity_invites_status_check
    CHECK (status IN ('sent', 'applied', 'declined', 'expired')),
  CONSTRAINT opportunity_invites_note_length CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT opportunity_invites_distinct CHECK (club_id <> player_id)
);

COMMENT ON TABLE public.opportunity_invites IS
  'D3 Invite to apply. One OPEN (status=sent) invite per player per club at a time. Written only by send_invite / respond_invite / the application link triggers / expire_offers_and_invites.';

-- One open invite per player per club (founder ruling 2026-09-26).
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_invites_one_open_per_club
  ON public.opportunity_invites (club_id, player_id) WHERE status = 'sent';
-- Daily limit lookups.
CREATE INDEX IF NOT EXISTS opportunity_invites_club_sent_at
  ON public.opportunity_invites (club_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS opportunity_invites_player
  ON public.opportunity_invites (player_id, status);
CREATE INDEX IF NOT EXISTS opportunity_invites_opportunity
  ON public.opportunity_invites (opportunity_id, status);
CREATE INDEX IF NOT EXISTS opportunity_invites_open_expiry
  ON public.opportunity_invites (expires_at) WHERE status = 'sent';

ALTER TABLE public.opportunity_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opportunity_invites_select_parties ON public.opportunity_invites;
CREATE POLICY opportunity_invites_select_parties ON public.opportunity_invites
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = club_id OR (SELECT auth.uid()) = player_id);

REVOKE ALL ON TABLE public.opportunity_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.opportunity_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.opportunity_invites TO service_role;


-- ─── 3. opportunity_offers ─────────────────────────────────────────────────────
-- Versioned: every edit inserts a new row (version + 1) and marks the previous live
-- one superseded. At most one live offer per application. Terms are private to the
-- two parties: RLS lets only that club and that player read a row, and card
-- messages / notifications never carry the terms.

CREATE TABLE IF NOT EXISTS public.opportunity_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.opportunity_applications(id) ON DELETE CASCADE,
  opportunity_id  uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  club_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  start_date      date,
  length          text,
  pay             text,
  package         text[] NOT NULL DEFAULT '{}'::text[],
  open_until      date NOT NULL,
  note            text,
  status          text NOT NULL DEFAULT 'live',
  sent_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  responded_at    timestamptz,
  decline_reason  text,
  message_id      uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  CONSTRAINT opportunity_offers_status_check
    CHECK (status IN ('live', 'superseded', 'withdrawn', 'accepted', 'declined', 'expired', 'cancelled')),
  CONSTRAINT opportunity_offers_version_positive CHECK (version >= 1),
  CONSTRAINT opportunity_offers_length_limits CHECK (
        (length IS NULL OR char_length(length) <= 100)
    AND (pay IS NULL OR char_length(pay) <= 200)
    AND (note IS NULL OR char_length(note) <= 1000)
    AND (decline_reason IS NULL OR char_length(decline_reason) <= 500)
    AND coalesce(array_length(package, 1), 0) <= 12),
  CONSTRAINT opportunity_offers_version_unique UNIQUE (application_id, version)
);

COMMENT ON TABLE public.opportunity_offers IS
  'D4 offers. Versioned (one live row per application). Terms readable only by the club and the player. Written only by make_offer / withdraw_offer / respond_offer / withdraw_application / fill paths / expire_offers_and_invites.';
COMMENT ON COLUMN public.opportunity_offers.status IS
  'live = current version awaiting an answer; superseded = replaced by an edit; withdrawn = club took it back; accepted / declined = player answer; expired = past open_until; cancelled = application ended (player withdrew or role filled).';

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_offers_one_live
  ON public.opportunity_offers (application_id) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS opportunity_offers_club ON public.opportunity_offers (club_id);
CREATE INDEX IF NOT EXISTS opportunity_offers_player ON public.opportunity_offers (player_id);
CREATE INDEX IF NOT EXISTS opportunity_offers_live_open_until
  ON public.opportunity_offers (open_until) WHERE status = 'live';

ALTER TABLE public.opportunity_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opportunity_offers_select_parties ON public.opportunity_offers;
CREATE POLICY opportunity_offers_select_parties ON public.opportunity_offers
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = club_id OR (SELECT auth.uid()) = player_id);

REVOKE ALL ON TABLE public.opportunity_offers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.opportunity_offers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.opportunity_offers TO service_role;


-- ─── 4. opportunity_applications ───────────────────────────────────────────────
-- All nullable / defaulted: metadata-only column adds, no table rewrite.
-- Clients can't write them: UPDATE is column-limited to (status, metadata) since
-- 20260926100000, and the INSERT guard below resets them.

ALTER TABLE public.opportunity_applications
  ADD COLUMN IF NOT EXISTS invite_id uuid REFERENCES public.opportunity_invites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signing_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS signing_close_role boolean,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz;

COMMENT ON COLUMN public.opportunity_applications.invite_id IS 'Set when the application came from an invite (D3). Server-set only.';
COMMENT ON COLUMN public.opportunity_applications.trial IS 'D4 road to signing: the club ticked "trial". Set via set_trial() only.';
COMMENT ON COLUMN public.opportunity_applications.signing_requested_at IS 'When the club marked the signing (signed_pending_confirmation). Auto-expires after 14 days.';
COMMENT ON COLUMN public.opportunity_applications.signing_close_role IS 'Club''s choice at mark_signed: close the role as filled when the player confirms.';
COMMENT ON COLUMN public.opportunity_applications.signed_at IS 'When the player confirmed the signing. Signings count = applications with status signed.';

CREATE INDEX IF NOT EXISTS idx_opportunity_applications_invite
  ON public.opportunity_applications (invite_id) WHERE invite_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunity_applications_signing_pending
  ON public.opportunity_applications (signing_requested_at) WHERE signing_requested_at IS NOT NULL;


-- ─── 5. career_history ─────────────────────────────────────────────────────────

ALTER TABLE public.career_history
  ADD COLUMN IF NOT EXISTS signed_via_hockia boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.opportunity_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.career_history.signed_via_hockia IS 'Created by confirm_signing(). Clients cannot set or change it.';
COMMENT ON COLUMN public.career_history.is_hidden IS 'Owner-controlled: hidden entries are not shown to other people (direct reads).';

CREATE UNIQUE INDEX IF NOT EXISTS career_history_one_per_signing
  ON public.career_history (application_id) WHERE application_id IS NOT NULL;

-- Hidden entries stay readable by their owner and admins only. Same policy as live
-- otherwise (prod and staging identical, 2026-09-26).
DROP POLICY IF EXISTS "Public can view career history of visible profiles" ON public.career_history;
CREATE POLICY "Public can view career history of visible profiles" ON public.career_history
  FOR SELECT
  USING (
    (SELECT auth.uid()) = user_id
    OR public.is_platform_admin()
    OR (public.owner_profile_is_visible(user_id) AND NOT is_hidden)
  );


-- ─── 6. conversations.origin ───────────────────────────────────────────────────
-- 'Invitation' = started by send_invite (D3); 'Application' = started from an
-- application (Track A). NOT VALID + VALIDATE keeps the strong lock to the catalog
-- change; every existing row already satisfies the wider list.

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_origin_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_origin_check
  CHECK (origin = ANY (ARRAY['Community'::text, 'Profile'::text, 'Opportunity'::text,
                             'Hockia AI'::text, 'Direct'::text, 'unknown'::text,
                             'Invitation'::text, 'Application'::text]))
  NOT VALID;
ALTER TABLE public.conversations VALIDATE CONSTRAINT conversations_origin_check;


-- ─── 7. application_status_history.changed_via ─────────────────────────────────

ALTER TABLE public.application_status_history DROP CONSTRAINT IF EXISTS application_status_history_changed_via_check;
ALTER TABLE public.application_status_history
  ADD CONSTRAINT application_status_history_changed_via_check
  CHECK (changed_via = ANY (ARRAY['email_action'::text, 'auto_expiry'::text, 'minor_freeze'::text,
                                  'role_filled'::text, 'recruiting_expiry'::text]))
  NOT VALID;
ALTER TABLE public.application_status_history VALIDATE CONSTRAINT application_status_history_changed_via_check;


-- ─── 8. guard_application_client_write ─────────────────────────────────────────
-- Same as 20260926100000 plus:
--   * INSERT resets the new server-only columns.
--   * UPDATE only moves between the review states. An application that has reached
--     the offer / signing road (or was withdrawn / filled) is changed only through the
--     server functions, and a client can never set one of the new statuses.
--     no_response stays a valid starting point (clubs may still revive an expired one).

CREATE OR REPLACE FUNCTION public.guard_application_client_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- Same nine codes as REASON_CODES in supabase/functions/application-feedback/index.ts
  -- and APPLICATION_STATUS_REASONS in client/src/lib/applicationStatus.ts. Keep in sync.
  v_codes  text[] := ARRAY['position_filled','different_position','different_level','timing',
                           'location','eligibility','profile_incomplete','video_missing','other'];
  v_reason text;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- An application always starts as a fresh, pending application with only the
    -- applicant's optional note. Server-owned columns start empty.
    NEW.status               := 'pending';
    NEW.applied_at           := timezone('utc', now());
    NEW.invite_id            := NULL;
    NEW.trial                := false;
    NEW.signing_requested_at := NULL;
    NEW.signing_close_role   := NULL;
    NEW.signed_at            := NULL;
    NEW.metadata   := CASE
      WHEN jsonb_typeof(NEW.metadata) = 'object' AND NEW.metadata ? 'message'
        THEN jsonb_build_object('message', left(NEW.metadata->>'message', 1000))
      ELSE '{}'::jsonb
    END;
    RETURN NEW;
  END IF;

  -- UPDATE: only the club that owns the role gets here (the only UPDATE policy),
  -- and column privileges limit it to status + metadata.
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'A withdrawn application cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF OLD.status::text NOT IN ('pending', 'shortlisted', 'maybe', 'rejected', 'no_response') THEN
    RAISE EXCEPTION 'This application can only be changed through its offer or signing steps'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status::text NOT IN ('pending', 'shortlisted', 'maybe', 'rejected') THEN
    RAISE EXCEPTION 'Clubs can set pending, shortlisted, maybe or rejected only' USING ERRCODE = '42501';
  END IF;

  -- The club may set a reason code; everything else in metadata keeps its stored value
  -- (the applicant's note, system keys). changed_via is written by the system only.
  v_reason := CASE WHEN jsonb_typeof(NEW.metadata) = 'object' THEN NEW.metadata->>'status_reason' END;
  IF v_reason IS NOT NULL AND NOT (v_reason = ANY (v_codes)) THEN
    v_reason := NULL;
  END IF;
  NEW.metadata := (COALESCE(OLD.metadata, '{}'::jsonb) - 'status_reason' - 'changed_via')
                  || CASE WHEN v_reason IS NULL THEN '{}'::jsonb
                          ELSE jsonb_build_object('status_reason', v_reason) END;
  RETURN NEW;
END;
$$;


-- ─── 9. invite ↔ application link ──────────────────────────────────────────────
-- A player who applies while holding an open invite for that role — through the
-- normal Apply sheet (client INSERT) or respond_invite — gets the application tagged
-- with the invite, and the invite is marked applied with a card in the thread.
-- BEFORE trigger name sorts after trg_guard_application_client_write, so it runs after
-- the guard has cleared invite_id.

CREATE OR REPLACE FUNCTION public.link_application_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT i.id INTO NEW.invite_id
    FROM public.opportunity_invites i
   WHERE i.opportunity_id = NEW.opportunity_id
     AND i.player_id = NEW.applicant_id
     AND i.status = 'sent'
     AND i.expires_at > timezone('utc', now())
   ORDER BY i.sent_at DESC
   LIMIT 1;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.link_application_invite() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_link_application_invite ON public.opportunity_applications;
CREATE TRIGGER trg_link_application_invite
  BEFORE INSERT ON public.opportunity_applications
  FOR EACH ROW EXECUTE FUNCTION public.link_application_invite();

-- The AFTER half (mark the invite applied + card) needs the card helpers, so it is
-- created in 20260928120000 (mark_invite_applied).


-- ─── 10. record_application_status_history: the real actor ─────────────────────
-- Before: changed_by was always the role's club, even when the applicant or the
-- system made the change. Now: the signed-in user who made the change (auth.uid(),
-- which DEFINER functions keep); NULL for system moves (sweeps, freezes, fills with
-- no signed-in user); the club only for legacy service-role writes made on the club's
-- behalf (email action links, decline feedback), which carry no user.

CREATE OR REPLACE FUNCTION public.record_application_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_via   text := NEW.metadata->>'changed_via';
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF v_actor IS NULL
       AND coalesce(v_via, '') NOT IN ('auto_expiry', 'minor_freeze', 'role_filled', 'recruiting_expiry') THEN
      SELECT o.club_id INTO v_actor FROM public.opportunities o WHERE o.id = NEW.opportunity_id;
    END IF;
    INSERT INTO public.application_status_history (application_id, old_status, new_status, reason, changed_by, changed_via)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.metadata->>'status_reason', v_actor, v_via);
  END IF;
  RETURN NEW;
END;
$$;


-- ─── 11. career_history guard ──────────────────────────────────────────────────
-- Direct client writes only (current_user = 'authenticated'); confirm_signing runs as
-- the owner and is unaffected.

CREATE OR REPLACE FUNCTION public.guard_career_history_client_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.signed_via_hockia := false;
    NEW.signed_at         := NULL;
    NEW.application_id    := NULL;
    RETURN NEW;
  END IF;

  IF NEW.signed_via_hockia IS DISTINCT FROM OLD.signed_via_hockia
     OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
     OR NEW.application_id IS DISTINCT FROM OLD.application_id THEN
    RAISE EXCEPTION '"Signed through Hockia" is set by the signing itself' USING ERRCODE = '42501';
  END IF;

  IF OLD.signed_via_hockia
     AND (NEW.user_id       IS DISTINCT FROM OLD.user_id
       OR NEW.club_name     IS DISTINCT FROM OLD.club_name
       OR NEW.world_club_id IS DISTINCT FROM OLD.world_club_id
       OR NEW.years         IS DISTINCT FROM OLD.years
       OR NEW.start_date    IS DISTINCT FROM OLD.start_date
       OR NEW.entry_type    IS DISTINCT FROM OLD.entry_type) THEN
    RAISE EXCEPTION 'A signing made through Hockia keeps its club and season. You can hide or delete it.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_career_history_client_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_career_history_client_write ON public.career_history;
CREATE TRIGGER trg_guard_career_history_client_write
  BEFORE INSERT OR UPDATE ON public.career_history
  FOR EACH ROW EXECUTE FUNCTION public.guard_career_history_client_write();


-- ─── 12. messages: recruiting cards ────────────────────────────────────────────
-- Card types written by the server functions. Clients still can't insert them
-- (normalize_message_client_insert rejects any type but shared_post).

CREATE OR REPLACE FUNCTION public.is_recruiting_card(p_metadata jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(p_metadata->>'type', '') IN ('opportunity_invite', 'opportunity_offer', 'application_event');
$$;

REVOKE ALL ON FUNCTION public.is_recruiting_card(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_recruiting_card(jsonb) TO authenticated, service_role;

-- 12a. A recruiting card is a record of the step: its sender can't edit or delete it.
--      Same function as 20260926100000 plus that rule.
CREATE OR REPLACE FUNCTION public.enforce_message_update_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid             uuid    := auth.uid();
  v_content_changed boolean := NEW.content    IS DISTINCT FROM OLD.content;
  v_edited_changed  boolean := NEW.edited_at  IS DISTINCT FROM OLD.edited_at;
  v_deleted_changed boolean := NEW.deleted_at IS DISTINCT FROM OLD.deleted_at;
BEGIN
  -- Identity / threading columns are always immutable.
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

  -- Recruiting cards (invite / offer / signing steps) are fixed records for users.
  IF v_uid IS NOT NULL AND public.is_recruiting_card(OLD.metadata)
     AND (v_content_changed OR v_edited_changed OR v_deleted_changed
          OR NEW.metadata IS DISTINCT FROM OLD.metadata) THEN
    RAISE EXCEPTION 'This card can''t be edited or deleted';
  END IF;

  -- Metadata (the shared-post card) is fixed at send time. The one allowed change is
  -- delete_message clearing it together with the soft delete.
  IF NEW.metadata IS DISTINCT FROM OLD.metadata
     AND NOT (NEW.metadata IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Message metadata is immutable';
  END IF;

  -- A read receipt is set once (null → time) and never reset by a user.
  IF v_uid IS NOT NULL AND OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'Message read time is immutable';
  END IF;

  -- Fast path: pure read-receipt update (only read_at changed) — unchanged
  -- behaviour, no further checks.
  IF NOT v_content_changed AND NOT v_edited_changed AND NOT v_deleted_changed THEN
    RETURN NEW;
  END IF;

  -- Any change to content / edited_at / deleted_at is an edit or a delete,
  -- which only the author may perform. Defence in depth behind the RPCs; also
  -- blocks the recipient (who can UPDATE via the "mark as read" policy) from
  -- forging one. A NULL uid is a trusted server/service-role context.
  IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'Only the author can edit or delete a message';
  END IF;

  -- A deleted message is a frozen tombstone: no un-delete, no further edits.
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted messages cannot be modified';
  END IF;

  -- Content may change only as part of an edit (edited_at advances) or a
  -- soft-delete (deleted_at gets set this update). A bare content change with
  -- neither marker is still rejected, preserving the original guarantee.
  IF v_content_changed
     AND NOT v_edited_changed
     AND NOT (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Message content is immutable';
  END IF;

  RETURN NEW;
END;
$$;

-- 12b. Each recruiting step already sends one recruiting_update notification with
--      specific copy; the generic "new message" bell/push would duplicate it. Same
--      function as live (md5 identical on prod and staging 2026-09-26) plus the skip.
CREATE OR REPLACE FUNCTION public.handle_message_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  recipient uuid;
  other_exists boolean;
  existing_notification record;
  existing_count int;
  sender_ids jsonb;
BEGIN
  -- Recruiting cards notify through recruiting_update (see 20260928120000).
  IF public.is_recruiting_card(NEW.metadata) THEN
    RETURN NEW;
  END IF;

  -- Get the recipient of this message
  SELECT CASE
    WHEN c.participant_one_id = NEW.sender_id THEN c.participant_two_id
    ELSE c.participant_one_id
  END
  INTO recipient
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  IF recipient IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check for existing unread message notification for this conversation
  SELECT id, metadata
  INTO existing_notification
  FROM public.profile_notifications
  WHERE recipient_profile_id = recipient
    AND kind = 'message_received'
    AND source_entity_id = NEW.conversation_id  -- Use conversation_id as source
    AND read_at IS NULL
    AND cleared_at IS NULL
  LIMIT 1;

  IF existing_notification IS NOT NULL THEN
    -- Aggregate: update existing notification with new message info
    existing_count := coalesce((existing_notification.metadata->>'message_count')::int, 1);
    sender_ids := coalesce(existing_notification.metadata->'sender_ids', '[]'::jsonb);

    -- Add sender to list if not already present
    IF NOT sender_ids ? NEW.sender_id::text THEN
      sender_ids := sender_ids || to_jsonb(NEW.sender_id::text);
    END IF;

    UPDATE public.profile_notifications
    SET
      metadata = jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'last_message_id', NEW.id,
        'message_count', existing_count + 1,
        'sender_ids', sender_ids
      ),
      updated_at = timezone('utc', now()),
      -- Keep created_at unchanged to preserve original notification time
      actor_profile_id = NEW.sender_id  -- Update to latest sender
    WHERE id = existing_notification.id;
  ELSE
    -- Create new notification with conversation_id as source_entity_id
    PERFORM public.enqueue_notification(
      recipient,
      NEW.sender_id,
      'message_received',
      NEW.conversation_id,  -- Changed from NEW.id to NEW.conversation_id
      jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'last_message_id', NEW.id,
        'message_count', 1,
        'sender_ids', jsonb_build_array(NEW.sender_id::text)
      ),
      NULL
    );
  END IF;

  -- Check if this is the first message in the conversation
  SELECT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.conversation_id = NEW.conversation_id AND m.id <> NEW.id
  ) INTO other_exists;

  IF NOT other_exists THEN
    PERFORM public.enqueue_notification(
      recipient,
      NEW.sender_id,
      'conversation_started',
      NEW.conversation_id,
      jsonb_build_object(
        'conversation_id', NEW.conversation_id
      ),
      NULL
    );
  END IF;

  RETURN NEW;
END;
$function$;
