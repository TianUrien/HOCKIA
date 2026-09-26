-- ROLLBACK for supabase/migrations/20260928110000 … 20260928130000 (Track C groundwork).
-- NOT a migration (this folder is never pushed). Emergency use only. Restores the exact
-- pre-migration function bodies, policies and constraints (identical on prod and staging,
-- read 2026-09-26) and removes the new tables, columns, functions, triggers and cron job.
-- DATA LOSS: drops opportunity_invites / opportunity_offers and the new columns. Any
-- application already in a new status (offered … filled) must be moved back first, e.g.
--   UPDATE opportunity_applications SET status = 'shortlisted'
--    WHERE status::text IN ('offered','accepted','signed_pending_confirmation','offer_declined');
-- The enum values from 20260928100000 cannot be dropped and stay (unused).
-- Apply with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f <this file>
-- then:  supabase migration repair --status reverted 20260928130000 20260928120000 20260928110000 --linked

DO $$ BEGIN PERFORM cron.unschedule('recruiting_expiry_daily'); EXCEPTION WHEN others THEN NULL; END $$;

-- 20260928130000
CREATE OR REPLACE FUNCTION public.compute_club_fit(p_owner_id uuid, p_player_id uuid, p_target text, p_region text, p_opportunity_id uuid)
 RETURNS TABLE(score numeric, state text, components jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role     TEXT;
  v_player          RECORD;
  v_owner           RECORD;
  v_player_band     INTEGER;
  v_viewer_band     INTEGER;
  v_gender_match    NUMERIC;
  v_proximity       NUMERIC;
  v_availability    NUMERIC;
  v_recency         NUMERIC;
  v_is_open         BOOLEAN;
  v_active_factor   NUMERIC;
  v_score           NUMERIC;
  v_state           TEXT;
  v_band_distance   NUMERIC;
BEGIN
  -- Fit is clubs-only: the caller must be the owner it asks about, and a
  -- club or a coach. Anyone else gets no row at all — not a zero, not an
  -- error — so nothing about a player's fit leaks to a player.
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_owner_id THEN
    RETURN;
  END IF;
  SELECT p.role INTO v_caller_role FROM public.profiles p WHERE p.id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'club' AND v_caller_role IS DISTINCT FROM 'coach' THEN
    RETURN;
  END IF;

  SELECT
    p.playing_category,
    p.current_world_club_id,
    p.open_to_play,
    p.open_to_coach,
    p.open_to_opportunities,
    p.last_active_at
  INTO v_player
  FROM public.profiles p
  WHERE p.id = p_player_id;

  IF NOT FOUND THEN
    -- Player doesn't exist → return zeroed row instead of NULL so the
    -- caller can distinguish "no data" from "low score".
    RETURN QUERY SELECT
      0::NUMERIC,
      'grey'::TEXT,
      jsonb_build_object(
        'gender_match', 0,
        'competition_proximity', 0,
        'availability', 0,
        'recency', 0
      );
    RETURN;
  END IF;

  SELECT current_world_club_id INTO v_owner
  FROM public.profiles
  WHERE id = p_owner_id;

  -- Gender match: 1 if player's category falls in the target's allowed
  -- set, else 0. Null target (no context resolution) → 0.
  v_gender_match := CASE WHEN public._target_accepts_category(p_target, v_player.playing_category) THEN 1 ELSE 0 END;

  -- Competition proximity via curated 1..10 level_band_global.
  v_player_band := public._player_level_band(v_player.current_world_club_id, v_player.playing_category);
  v_viewer_band := public._club_level_band(v_owner.current_world_club_id, p_target);
  IF v_player_band IS NULL OR v_viewer_band IS NULL THEN
    v_proximity := 0;
  ELSE
    v_band_distance := ABS(v_player_band - v_viewer_band);
    v_proximity := GREATEST(0, 1 - v_band_distance / 4.0);
  END IF;

  -- Availability: 0.6 * open_to_X + 0.4 * recency_30d(last_active_at)
  v_is_open := COALESCE(v_player.open_to_play, FALSE)
            OR COALESCE(v_player.open_to_coach, FALSE)
            OR COALESCE(v_player.open_to_opportunities, FALSE);
  v_active_factor := public._recency_30d(v_player.last_active_at);
  v_availability := LEAST(1, GREATEST(0,
    0.6 * (CASE WHEN v_is_open THEN 1 ELSE 0 END) + 0.4 * v_active_factor
  ));

  -- Recency component (10% weight) — uses same last_active_at as
  -- availability since profile_updated_at column isn't populated
  -- consistently yet. Mirrors the TS implementation.
  v_recency := v_active_factor;

  v_score := LEAST(1, GREATEST(0,
    0.40 * v_proximity +
    0.30 * v_gender_match +
    0.20 * v_availability +
    0.10 * v_recency
  ));

  v_state := CASE
    WHEN v_score >= 0.66 THEN 'green'
    WHEN v_score >= 0.40 THEN 'yellow'
    ELSE 'grey'
  END;

  RETURN QUERY SELECT
    v_score,
    v_state,
    jsonb_build_object(
      'gender_match', v_gender_match,
      'competition_proximity', v_proximity,
      'availability', v_availability,
      'recency', v_recency
    );
END;
$function$;

-- 20260928120000
DROP TRIGGER IF EXISTS trg_opportunity_recruiting_close ON public.opportunities;
DROP TRIGGER IF EXISTS trg_guard_opportunity_filled_via_hockia ON public.opportunities;
DROP FUNCTION IF EXISTS public.guard_opportunity_filled_via_hockia();
DROP TRIGGER IF EXISTS trg_mark_invite_applied ON public.opportunity_applications;
DROP FUNCTION IF EXISTS public.expire_offers_and_invites();
DROP FUNCTION IF EXISTS public.fill_role(uuid);
DROP FUNCTION IF EXISTS public.set_trial(uuid, boolean);
DROP FUNCTION IF EXISTS public.confirm_signing(uuid, boolean);
DROP FUNCTION IF EXISTS public.undo_mark_signed(uuid);
DROP FUNCTION IF EXISTS public.mark_signed(uuid, boolean);
DROP FUNCTION IF EXISTS public.withdraw_application(uuid);
DROP FUNCTION IF EXISTS public.respond_offer(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.withdraw_offer(uuid);
DROP FUNCTION IF EXISTS public.make_offer(uuid, date, date, text, text, text[], text);
DROP FUNCTION IF EXISTS public.respond_invite(uuid, text, text);
DROP FUNCTION IF EXISTS public.send_invite(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.mark_invite_applied();
DROP FUNCTION IF EXISTS public.handle_opportunity_recruiting_close();
DROP FUNCTION IF EXISTS public._fill_waiting_applications(uuid);
DROP FUNCTION IF EXISTS public._application_resting_status(uuid);
DROP FUNCTION IF EXISTS public._recruiting_date_label(date);
DROP FUNCTION IF EXISTS public._set_application_status(uuid, text, text);
DROP FUNCTION IF EXISTS public._recruiting_notify(uuid, uuid, uuid, text, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public._post_recruiting_card(uuid, uuid, text, jsonb, boolean);
DROP FUNCTION IF EXISTS public._recruiting_conversation(uuid, uuid, text);

-- 20260928110000 §12
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

DROP FUNCTION IF EXISTS public.is_recruiting_card(jsonb);

-- §11
DROP TRIGGER IF EXISTS trg_guard_career_history_client_write ON public.career_history;
DROP FUNCTION IF EXISTS public.guard_career_history_client_write();

-- §10
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

-- §9
DROP TRIGGER IF EXISTS trg_link_application_invite ON public.opportunity_applications;
DROP FUNCTION IF EXISTS public.link_application_invite();

-- §8 (body of 20260926100000)
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
    -- applicant's optional note.
    NEW.status     := 'pending';
    NEW.applied_at := timezone('utc', now());
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

-- §7
ALTER TABLE public.application_status_history DROP CONSTRAINT IF EXISTS application_status_history_changed_via_check;
ALTER TABLE public.application_status_history
  ADD CONSTRAINT application_status_history_changed_via_check
  CHECK (changed_via = ANY (ARRAY['email_action'::text, 'auto_expiry'::text, 'minor_freeze'::text]));

-- §6 (fails if a conversation already uses 'Invitation' / 'Application')
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_origin_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_origin_check
  CHECK (origin = ANY (ARRAY['Community'::text, 'Profile'::text, 'Opportunity'::text,
                             'Hockia AI'::text, 'Direct'::text, 'unknown'::text]));

-- §5
DROP POLICY IF EXISTS "Public can view career history of visible profiles" ON public.career_history;
CREATE POLICY "Public can view career history of visible profiles" ON public.career_history
  FOR SELECT
  USING (((SELECT auth.uid()) = user_id) OR public.is_platform_admin() OR public.owner_profile_is_visible(user_id));
DROP INDEX IF EXISTS public.career_history_one_per_signing;
ALTER TABLE public.career_history
  DROP COLUMN IF EXISTS is_hidden,
  DROP COLUMN IF EXISTS application_id,
  DROP COLUMN IF EXISTS signed_at,
  DROP COLUMN IF EXISTS signed_via_hockia;

-- §4
ALTER TABLE public.opportunity_applications
  DROP COLUMN IF EXISTS signed_at,
  DROP COLUMN IF EXISTS signing_close_role,
  DROP COLUMN IF EXISTS signing_requested_at,
  DROP COLUMN IF EXISTS trial,
  DROP COLUMN IF EXISTS invite_id;

-- §3, §2, §1
DROP TABLE IF EXISTS public.opportunity_offers;
DROP TABLE IF EXISTS public.opportunity_invites;
DROP FUNCTION IF EXISTS public.is_minor(uuid);

NOTIFY pgrst, 'reload schema';
