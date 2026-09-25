-- Phase 1 · step 2 — close five client write paths that were exploitable on production
-- (security audit 2026-09-25). No data is rewritten; this only changes who may write what.
-- Rollback: supabase/rollbacks/20260926100000_phase1_close_client_write_holes.down.sql
--
-- Pattern: every guard below acts only on DIRECT client writes (current_user = 'authenticated',
-- i.e. PostgREST with a user JWT). SECURITY DEFINER functions run as their owner (postgres),
-- the service role is 'service_role', and FK cascades run as the table owner, so every
-- legitimate server path — RPCs, edge functions, cron sweeps, account deletion — is untouched.
--
--   1. conversations           a participant could swap the other person out of a thread
--   2. opportunity_applications a club could rewrite applicant_id / applied_at / any status;
--                              an applicant could insert an application as "shortlisted"
--   3. profile_references      the endorser could flip a revoked/declined reference back to accepted
--   4. user_posts              direct inserts skipped every RPC fence (fake "signed with" posts)
--   5. messages                recipients could rewrite a message's card; senders could backdate
--                              and spoof shared-post cards


-- ─── 1. conversations ──────────────────────────────────────────────────────────
-- No client updates conversations; the only UPDATE was the invoker trigger that bumps
-- last_message_at on a new message. Make that trigger DEFINER and drop the UPDATE policy.
-- The immutability trigger is defence in depth should a policy ever come back.

CREATE OR REPLACE FUNCTION public.enforce_conversation_update_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF NEW.participant_one_id IS DISTINCT FROM OLD.participant_one_id
     OR NEW.participant_two_id IS DISTINCT FROM OLD.participant_two_id
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Conversation participants, origin and creation time cannot change'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_conversation_immutability ON public.conversations;
CREATE TRIGGER enforce_conversation_immutability
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_update_immutability();

ALTER FUNCTION public.update_conversation_timestamp() SECURITY DEFINER;

DROP POLICY IF EXISTS "Users can update conversations" ON public.conversations;


-- ─── 2. opportunity_applications ───────────────────────────────────────────────
-- Clubs update applications directly (status + metadata.status_reason) from the desktop
-- Applicants list and the Club v2 decision bar. Everything else goes through DEFINER
-- functions or the application-feedback edge function (service role).

REVOKE UPDATE ON public.opportunity_applications FROM anon, authenticated;
GRANT UPDATE (status, metadata) ON public.opportunity_applications TO authenticated;

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

DROP TRIGGER IF EXISTS trg_guard_application_client_write ON public.opportunity_applications;
CREATE TRIGGER trg_guard_application_client_write
  BEFORE INSERT OR UPDATE ON public.opportunity_applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_application_client_write();


-- ─── 3. profile_references ─────────────────────────────────────────────────────
-- Every legitimate write is a DEFINER function (request_reference, respond_reference,
-- remove_reference, withdraw_reference, edit_endorsement, block_user,
-- revoke_references_on_friendship_end). The direct write policies only enabled abuse.
-- Kept: profile_references_read, profile_references_delete.

DROP POLICY IF EXISTS profile_references_insert ON public.profile_references;
DROP POLICY IF EXISTS profile_references_reference_update ON public.profile_references;
DROP POLICY IF EXISTS profile_references_requester_update ON public.profile_references;


-- ─── 4. user_posts ─────────────────────────────────────────────────────────────
-- The client writes posts only through DEFINER functions (create_user_post,
-- create_signing_post, create_transfer_post, update_user_post, delete_user_post), and the
-- like/comment counters are DEFINER triggers. Direct writes skipped the club-only rule for
-- signing posts, the content filter, the rate limit, and let authors set their own counts.
-- Kept: user_posts_select_public, user_posts_delete_blocked.

DROP POLICY IF EXISTS user_posts_insert_own ON public.user_posts;
DROP POLICY IF EXISTS user_posts_update_own ON public.user_posts;
REVOKE INSERT, UPDATE ON public.user_posts FROM anon, authenticated;


-- ─── 5. messages ───────────────────────────────────────────────────────────────
-- 5a. UPDATE: metadata was not covered by the immutability trigger, so a recipient
--     (who may UPDATE through the "mark as read" policy) could replace a received
--     message with a fake card. read_at could also be reset. Same function as before,
--     plus those two checks.

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

-- 5b. INSERT: the server stamps the send time, and a shared-post card is rebuilt from
--     the real post, so a sender can't backdate a message or put words in someone
--     else's mouth. The card's text, author and role now come from the database; the
--     client's thumbnail is kept only if it is one of that post's own images.

CREATE OR REPLACE FUNCTION public.shared_post_card(p_post_id uuid, p_thumbnail_url text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH post AS (
    SELECT up.id, up.author_id, up.content, p.full_name, p.avatar_url, p.role,
           CASE WHEN jsonb_typeof(up.images) = 'array' THEN up.images ELSE '[]'::jsonb END AS images
    FROM public.user_posts up
    JOIN public.profiles p ON p.id = up.author_id
    WHERE up.id = p_post_id
      AND up.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'type', 'shared_post',
    'post_id', post.id,
    'author_id', post.author_id,
    'author_name', post.full_name,
    'author_avatar', post.avatar_url,
    'author_role', post.role,
    'content_preview', left(coalesce(post.content, ''), 150),
    'thumbnail_url', CASE
      WHEN p_thumbnail_url IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(post.images) e
        WHERE e->>'url' = p_thumbnail_url OR e->>'thumb_url' = p_thumbnail_url
      ) THEN p_thumbnail_url
      ELSE (SELECT coalesce(nullif(e->>'thumb_url', ''), e->>'url')
            FROM jsonb_array_elements(post.images) e LIMIT 1)
    END
  )
  FROM post;
$$;

REVOKE ALL ON FUNCTION public.shared_post_card(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_post_card(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.normalize_message_client_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_card jsonb;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  NEW.sent_at    := timezone('utc', now());
  NEW.read_at    := NULL;
  NEW.edited_at  := NULL;
  NEW.deleted_at := NULL;

  IF NEW.metadata IS NULL OR jsonb_typeof(NEW.metadata) = 'null' THEN
    NEW.metadata := NULL;
  ELSIF NEW.metadata->>'type' = 'shared_post' THEN
    v_card := public.shared_post_card(
      NULLIF(NEW.metadata->>'post_id', '')::uuid,
      NEW.metadata->>'thumbnail_url'
    );
    IF v_card IS NULL THEN
      RAISE EXCEPTION 'The shared post is no longer available' USING ERRCODE = 'P0002';
    END IF;
    NEW.metadata := v_card;
  ELSE
    RAISE EXCEPTION 'Unsupported message attachment' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_normalize_client_insert ON public.messages;
CREATE TRIGGER messages_normalize_client_insert
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.normalize_message_client_insert();
