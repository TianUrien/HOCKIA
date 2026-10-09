-- =========================================================================
-- Club recruiting flow fixes (release audit, founder-approved 2026-10-09)
-- =========================================================================
--
-- A · Decline after Good fit / Maybe tells the player.
--     handle_opportunity_application_notifications only notified on a move
--     OUT OF 'pending'. A player moved shortlisted → rejected or
--     maybe → rejected heard nothing. Now: ANY move into 'rejected', and a
--     move into 'shortlisted' from 'pending' or 'maybe', notifies the player
--     (same kind vacancy_application_status, same metadata, same status-email
--     pipeline). The name in club_name is the organisation the role recruits
--     for (role_organisation) for a coach's role, the club account's name for
--     a club, as in _fill_waiting_applications. Players read "Not selected"
--     (client copy helpers, unchanged).
--     Status email: profile_notifications holds ONE row per
--     (recipient, kind, application); enqueue_notification upserts it and
--     never resets emailed_at. A decline after an emailed Good fit therefore
--     re-used an already-emailed row and the decline email (with the club's
--     note from ai_feedback) was never sent. When the row's status really
--     changes, emailed_at is reset — unless an unprocessed email batch already
--     holds the row (that batch reads the current status and note when it
--     sends). When the row already carries the same status (e.g. rejected →
--     pending → rejected), nothing is re-sent.
--     Server moves never reach these branches: offer / signing functions and
--     the recruiting expiry move into 'shortlisted' only from offered /
--     offer_declined / accepted / signed_pending_confirmation, the expiry
--     sweep moves to 'no_response', fills move to 'filled', a reopen restores
--     from 'filled'. None of them moves into 'rejected'.
--
-- B · Reopening a role closed as filled gives its applicants back.
--     Closing a role as filled moves every waiting application (pending,
--     shortlisted, maybe, offered, accepted) to 'filled' and cancels live
--     offers (_fill_waiting_applications); reopening restored nothing, although
--     the close dialog promises "Existing applicants stay attached — you can
--     reopen it any time". Founder ruling 2026-10-09: on reopen, every
--     application the close moved to 'filled' goes back to the exact status it
--     had; the signed player stays signed.
--       * At fill time the previous status and the club's reason code are now
--         recorded on the application (metadata.before_filled).
--       * When a role becomes 'open' again (any writer: desktop, phone, older
--         apps, renewal links — it is a trigger on opportunities), every
--         application of it at 'filled' with metadata.changed_via = 'role_filled'
--         goes back. Previous status, first that exists:
--           1. metadata.before_filled.status (fills after this migration);
--           2. the newest application_status_history row into 'filled' with
--              changed_via = 'role_filled' — its old_status (fills since
--              20260928120000 already logged it);
--           3. 'pending'.
--         Anything outside the waiting statuses also falls back to 'pending'.
--       * 'offered': the offer that close cancelled (the newest version, still
--         'cancelled') is live again when its open-until date is today or later;
--         otherwise the application goes back to 'shortlisted', as the offer
--         expiry does.
--       * No new notification. The player's stale "role filled" message for
--         that application is cleared; the restore itself is silent (the
--         notification trigger never fires on a move out of 'filled').
--       * The history row of a restore is old_status 'filled' with the club as
--         actor; changed_via stays NULL (the CHECK on changed_via is unchanged).
--         Response metrics only count moves out of 'pending', so a restore is
--         never counted as a club response.
--
-- C · A role with a signing can't be deleted.
--     "Delete permanently" on a closed role deleted it, and its applications
--     cascade with it, including a confirmed signing (counted as status
--     'signed', 20261002100000_d4_signings_metric.sql). Founder ruling
--     2026-10-09: refuse. A BEFORE DELETE trigger on opportunities raises P0001
--     "This role has a confirmed signing, so it can't be deleted. Close it
--     instead." (DETAIL role_has_signing) when any application of the role is
--     'signed' or 'signed_pending_confirmation', for every caller.
--     Account deletion is the one exception: when a publisher deletes their
--     account, hard_delete_profile_relations removes everything they own. It
--     now marks its transaction (hockia.deleting_profile = the profile id) and
--     the trigger lets that publisher's roles go; a cascade from the profile
--     row itself (profile already gone) is let through too. A client can't set
--     the marker: it is transaction-local and set_config is not exposed.
--
-- Each redefined body is the latest definition plus the lines this file needs:
--   handle_opportunity_application_notifications ← 20260706090000_application_expiry.sql
--   _fill_waiting_applications                   ← 20261004200000_role_organisation_name.sql
--   handle_opportunity_recruiting_close          ← 20260928120000_recruiting_server_functions.sql
--   hard_delete_profile_relations                ← 202603230400_rename_vacancy_rpcs_to_opportunity.sql
-- New: _restore_filled_applications(uuid), guard_opportunity_delete_with_signing()
--      + trigger trg_guard_opportunity_delete_with_signing.
--
-- Rollback: supabase/rollbacks/20261009200000_club_flow_fixes.down.sql
-- Probes:   supabase/tests/security/club_flow_fixes_acl.probe.sql (read-only)
--           supabase/tests/security/club_flow_fixes.probe.sql (staging, rolled back)
-- =========================================================================


-- ═══ A · handle_opportunity_application_notifications ═══
-- Body = 20260706090000_application_expiry.sql + the decline / maybe / email lines.

CREATE OR REPLACE FUNCTION public.handle_opportunity_application_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opportunity_id UUID;
  v_club_id UUID;
  v_opportunity_title TEXT;
  v_club_name TEXT;
  v_position public.opportunity_position;
  v_publisher_role TEXT;
  v_prev_status TEXT;
  v_notification_id UUID;
BEGIN
  SELECT o.id, o.club_id, o.title, p.full_name, o.position, p.role::text
  INTO v_opportunity_id, v_club_id, v_opportunity_title, v_club_name, v_position, v_publisher_role
  FROM public.opportunities o
  LEFT JOIN public.profiles p ON p.id = o.club_id
  WHERE o.id = NEW.opportunity_id;

  IF v_club_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.enqueue_notification(
      v_club_id,
      NEW.applicant_id,
      'vacancy_application_received',
      NEW.id,
      jsonb_build_object(
        'application_id', NEW.id,
        'opportunity_id', NEW.opportunity_id,
        'opportunity_title', v_opportunity_title,
        'applicant_id', NEW.applicant_id,
        'application_status', NEW.status
      ),
      NULL
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      UPDATE public.profile_notifications
         SET cleared_at = timezone('utc', now())
       WHERE kind = 'vacancy_application_received'
         AND source_entity_id = NEW.id;

      -- 'maybe' intentionally absent as a target: player-side it stays "under review".
      -- 'no_response' intentionally absent: the expiry sweep sends ONE
      -- per-player aggregate instead of per-row notifications.
      -- Any move into 'rejected' tells the player (also after Good fit / Maybe);
      -- 'shortlisted' only when it comes from review ('pending' / 'maybe'), never
      -- when an offer or signing step falls back to it.
      IF NEW.status = 'rejected'
         OR (NEW.status = 'shortlisted' AND OLD.status IN ('pending', 'maybe')) THEN
        -- The message this player already has for this application, if any.
        SELECT pn.metadata->>'status' INTO v_prev_status
          FROM public.profile_notifications pn
         WHERE pn.recipient_profile_id = NEW.applicant_id
           AND pn.kind = 'vacancy_application_status'
           AND pn.source_entity_id = NEW.id;

        -- Same message already delivered (e.g. rejected → pending → rejected): nothing new.
        IF v_prev_status IS DISTINCT FROM NEW.status::text THEN
          -- A club account as before; a coach's role names the organisation it
          -- recruits for (role_organisation), else the coach.
          IF v_publisher_role IS DISTINCT FROM 'club' THEN
            v_club_name := coalesce((SELECT ro.name FROM public.role_organisation(NEW.opportunity_id) ro), v_club_name);
          END IF;

          v_notification_id := public.enqueue_notification(
            NEW.applicant_id,
            v_club_id,
            'vacancy_application_status',
            NEW.id,
            jsonb_build_object(
              'application_id', NEW.id,
              'opportunity_id', NEW.opportunity_id,
              'vacancy_title', v_opportunity_title,
              'club_name', v_club_name,
              'position', v_position,
              'status', NEW.status
            ),
            NULL
          );

          -- The row is re-used per application: a new status must be emailable
          -- again, unless a batch still waiting to send already holds the row.
          IF v_notification_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.application_status_email_queue q
                              WHERE q.processed_at IS NULL
                                AND v_notification_id = ANY (q.notification_ids)) THEN
            UPDATE public.profile_notifications
               SET emailed_at = NULL
             WHERE id = v_notification_id
               AND emailed_at IS NOT NULL;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger function: fires as its owner whatever the grants; nobody calls it directly.
REVOKE ALL ON FUNCTION public.handle_opportunity_application_notifications() FROM PUBLIC, anon, authenticated;


-- ═══ B1 · _fill_waiting_applications ═══
-- Body = 20261004200000_role_organisation_name.sql + the before_filled lines.

CREATE OR REPLACE FUNCTION public._fill_waiting_applications(p_opportunity_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opp   record;
  v_app   record;
  v_count integer := 0;
BEGIN
  -- club_name: a club account as before; a coach's role names the organisation it
  -- recruits for (role_organisation), else the coach.
  SELECT o.id, o.club_id, o.title, o.position,
         CASE WHEN p.role = 'club' THEN p.full_name
              ELSE coalesce((SELECT ro.name FROM public.role_organisation(o.id) ro), p.full_name) END AS club_name
    INTO v_opp
    FROM public.opportunities o
    LEFT JOIN public.profiles p ON p.id = o.club_id
   WHERE o.id = p_opportunity_id;

  FOR v_app IN
    SELECT a.id, a.applicant_id, a.status::text AS status, a.metadata->>'status_reason' AS status_reason
      FROM public.opportunity_applications a
     WHERE a.opportunity_id = p_opportunity_id
       AND a.status::text IN ('pending', 'shortlisted', 'maybe', 'offered', 'accepted')
     FOR UPDATE
  LOOP
    UPDATE public.opportunity_offers
       SET status = 'cancelled', responded_at = timezone('utc', now())
     WHERE application_id = v_app.id AND status = 'live';

    -- What a reopen restores (_restore_filled_applications). Metadata only, so no
    -- status history row; _set_application_status keeps this key.
    UPDATE public.opportunity_applications
       SET metadata = coalesce(metadata, '{}'::jsonb)
                      || jsonb_build_object('before_filled',
                           jsonb_build_object('status', v_app.status, 'status_reason', v_app.status_reason))
     WHERE id = v_app.id;

    PERFORM public._set_application_status(v_app.id, 'filled', 'role_filled');

    -- Same kind the applicant already gets for shortlisted / rejected, so every app
    -- version renders it ("<club> updated your application").
    PERFORM public.enqueue_notification(
      v_app.applicant_id,
      v_opp.club_id,
      'vacancy_application_status'::public.profile_notification_kind,
      v_app.id,
      jsonb_build_object(
        'application_id', v_app.id,
        'opportunity_id', p_opportunity_id,
        'vacancy_title', v_opp.title,
        'club_name', v_opp.club_name,
        'position', v_opp.position,
        'status', 'filled'),
      NULL);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Unchanged, restated (internal: called from the opportunities trigger only).
REVOKE ALL ON FUNCTION public._fill_waiting_applications(uuid) FROM PUBLIC, anon, authenticated;


-- ═══ B2 · _restore_filled_applications (new) ═══

CREATE OR REPLACE FUNCTION public._restore_filled_applications(p_opportunity_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app    record;
  v_offer  record;
  v_status text;
  v_reason text;
  v_count  integer := 0;
BEGIN
  FOR v_app IN
    SELECT a.id, a.applicant_id, a.metadata
      FROM public.opportunity_applications a
     WHERE a.opportunity_id = p_opportunity_id
       AND a.status::text = 'filled'
       AND a.metadata->>'changed_via' = 'role_filled'
     FOR UPDATE
  LOOP
    -- 1. recorded at fill time
    v_status := nullif(v_app.metadata->'before_filled'->>'status', '');
    v_reason := nullif(v_app.metadata->'before_filled'->>'status_reason', '');

    -- 2. fills before 20261009200000: the history row of that fill
    IF v_status IS NULL THEN
      SELECT h.old_status::text INTO v_status
        FROM public.application_status_history h
       WHERE h.application_id = v_app.id
         AND h.new_status::text = 'filled'
         AND h.changed_via = 'role_filled'
       ORDER BY h.created_at DESC, h.id DESC
       LIMIT 1;
    END IF;

    -- 3. nothing recorded (or not a waiting status): back to unsorted
    IF v_status IS NULL OR v_status NOT IN ('pending', 'shortlisted', 'maybe', 'offered', 'accepted') THEN
      v_status := 'pending';
    END IF;

    -- The offer this close cancelled comes back while it is still in date.
    IF v_status = 'offered' THEN
      SELECT f.id, f.status, f.open_until INTO v_offer
        FROM public.opportunity_offers f
       WHERE f.application_id = v_app.id
       ORDER BY f.version DESC
       LIMIT 1;
      IF v_offer.id IS NOT NULL AND v_offer.status = 'cancelled'
         AND v_offer.open_until >= (timezone('utc', now()))::date THEN
        UPDATE public.opportunity_offers
           SET status = 'live', responded_at = NULL
         WHERE id = v_offer.id;
      ELSE
        v_status := 'shortlisted';
      END IF;
    END IF;

    -- One update (status + metadata) so the history row carries the reason.
    UPDATE public.opportunity_applications a
       SET status   = v_status::public.application_status,
           metadata = (coalesce(a.metadata, '{}'::jsonb) - 'before_filled' - 'changed_via' - 'status_reason')
                      || CASE WHEN v_reason IS NULL THEN '{}'::jsonb
                              ELSE jsonb_build_object('status_reason', v_reason) END
     WHERE a.id = v_app.id;

    -- The "role filled" message is no longer true; no new message replaces it.
    UPDATE public.profile_notifications
       SET cleared_at = timezone('utc', now())
     WHERE recipient_profile_id = v_app.applicant_id
       AND kind = 'vacancy_application_status'
       AND source_entity_id = v_app.id
       AND metadata->>'status' = 'filled'
       AND cleared_at IS NULL;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public._restore_filled_applications(uuid) IS
  'Reopen of a role closed as filled: every application that close moved to filled goes back to its previous status (metadata.before_filled, else the fill''s history row, else pending). Called from the opportunities trigger only.';

REVOKE ALL ON FUNCTION public._restore_filled_applications(uuid) FROM PUBLIC, anon, authenticated;


-- ═══ B3 · handle_opportunity_recruiting_close ═══
-- Body = 20260928120000_recruiting_server_functions.sql + the reopen branch.

CREATE OR REPLACE FUNCTION public.handle_opportunity_recruiting_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Invites expire with the role.
  IF OLD.status = 'open' AND NEW.status <> 'open' THEN
    UPDATE public.opportunity_invites
       SET status = 'expired'
     WHERE opportunity_id = NEW.id AND status = 'sent';
  END IF;

  -- Closed as filled → everyone still waiting gets the kind note.
  IF NEW.status = 'closed' AND NEW.closed_reason = 'filled'
     AND (OLD.status IS DISTINCT FROM 'closed' OR OLD.closed_reason IS DISTINCT FROM 'filled') THEN
    PERFORM public._fill_waiting_applications(NEW.id);
  END IF;

  -- Open again → the applications a close as filled moved to 'filled' go back
  -- (founder ruling 2026-10-09). Signed / waiting-to-confirm are never touched.
  IF NEW.status = 'open' AND OLD.status IS DISTINCT FROM 'open' THEN
    PERFORM public._restore_filled_applications(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

-- Unchanged, restated. The trigger trg_opportunity_recruiting_close (AFTER UPDATE OF
-- status, closed_reason, 20260928120000) already fires on a reopen; it is not recreated.
REVOKE ALL ON FUNCTION public.handle_opportunity_recruiting_close() FROM PUBLIC, anon, authenticated;


-- ═══ C1 · guard_opportunity_delete_with_signing (new) + trigger ═══

CREATE OR REPLACE FUNCTION public.guard_opportunity_delete_with_signing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The publisher is deleting their account: everything they own goes.
  IF current_setting('hockia.deleting_profile', true) = OLD.club_id::text
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.club_id) THEN
    RETURN OLD;
  END IF;

  IF EXISTS (SELECT 1
               FROM public.opportunity_applications a
              WHERE a.opportunity_id = OLD.id
                AND a.status::text IN ('signed', 'signed_pending_confirmation')) THEN
    RAISE EXCEPTION 'This role has a confirmed signing, so it can''t be deleted. Close it instead.'
      USING ERRCODE = 'P0001', DETAIL = 'role_has_signing';
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.guard_opportunity_delete_with_signing() IS
  'BEFORE DELETE on opportunities: a role with a signed or waiting-to-confirm application is never deleted (close it instead), except when its publisher deletes their account.';

-- Trigger function: fires as its owner whatever the grants; nobody calls it directly.
REVOKE ALL ON FUNCTION public.guard_opportunity_delete_with_signing() FROM PUBLIC, anon, authenticated;

-- Named to sort before trigger_cleanup_on_opportunity_delete (BEFORE DELETE triggers
-- fire in name order), so a refused delete touches nothing.
DROP TRIGGER IF EXISTS trg_guard_opportunity_delete_with_signing ON public.opportunities;
CREATE TRIGGER trg_guard_opportunity_delete_with_signing
  BEFORE DELETE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.guard_opportunity_delete_with_signing();


-- ═══ C2 · hard_delete_profile_relations ═══
-- Body = 202603230400_rename_vacancy_rpcs_to_opportunity.sql + the account-deletion marker.

CREATE OR REPLACE FUNCTION public.hard_delete_profile_relations(
  p_user_id UUID,
  p_batch INTEGER DEFAULT 2000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB := '{}'::jsonb;
  batch_size INTEGER := GREATEST(COALESCE(p_batch, 2000), 100);
  deleted_profile INTEGER := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id_required';
  END IF;

  -- Account deletion: this publisher's roles go even with a signing
  -- (guard_opportunity_delete_with_signing). Transaction-local.
  PERFORM set_config('hockia.deleting_profile', p_user_id::text, true);

  result := jsonb_set(result, '{applications}', to_jsonb(public.delete_rows_where_clause('public.opportunity_applications'::regclass, 'applicant_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{vacancies}', to_jsonb(public.delete_rows_where_clause('public.opportunities'::regclass, 'club_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{playingHistory}', to_jsonb(public.delete_rows_where_clause('public.career_history'::regclass, 'user_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{galleryPhotos}', to_jsonb(public.delete_rows_where_clause('public.gallery_photos'::regclass, 'user_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{clubMedia}', to_jsonb(public.delete_rows_where_clause('public.club_media'::regclass, 'club_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{profileComments}', to_jsonb(public.delete_rows_where_clause('public.profile_comments'::regclass, 'profile_id = $1 OR author_profile_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{profileNotifications}', to_jsonb(public.delete_rows_where_clause('public.profile_notifications'::regclass, 'recipient_profile_id = $1 OR actor_profile_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{friendships}', to_jsonb(public.delete_rows_where_clause('public.profile_friendships'::regclass, 'user_one = $1 OR user_two = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{archivedMessages}', to_jsonb(public.delete_rows_where_clause('public.archived_messages'::regclass, 'sender_id = $1 OR conversation_id IN (SELECT id FROM public.conversations WHERE participant_one_id = $1 OR participant_two_id = $1)', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{messages}', to_jsonb(public.delete_rows_where_clause('public.messages'::regclass, 'conversation_id IN (SELECT id FROM public.conversations WHERE participant_one_id = $1 OR participant_two_id = $1)', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{conversations}', to_jsonb(public.delete_rows_where_clause('public.conversations'::regclass, 'participant_one_id = $1 OR participant_two_id = $1', p_user_id, batch_size)), true);
  result := jsonb_set(result, '{unreadCounters}', to_jsonb(public.delete_rows_where_clause('public.user_unread_counters'::regclass, 'user_id = $1', p_user_id, batch_size)), true);

  DELETE FROM public.profiles WHERE id = p_user_id;
  GET DIAGNOSTICS deleted_profile = ROW_COUNT;
  result := jsonb_set(result, '{profiles}', to_jsonb(deleted_profile), true);

  RETURN result;
END;
$$;

-- Unchanged, restated (202512101002_harden_admin_function_privileges.sql).
REVOKE ALL ON FUNCTION public.hard_delete_profile_relations(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_profile_relations(uuid, integer) TO service_role;
