-- ============================================================================
-- Harden user_post_comment_notification trigger against side-effect failures
-- ============================================================================
-- The original 20260427100001 trigger calls enqueue_notification via PERFORM
-- inside the parent INSERT INTO post_comments transaction. If the
-- enqueue_notification path RAISEs (RLS denial under SECURITY DEFINER edge
-- cases, FK race if recipient profile was hard-deleted between read and
-- write, disk pressure, etc.), the exception propagates and aborts the
-- comment INSERT.
--
-- That's the wrong trade-off: we'd rather lose a notification side-effect
-- than reject a legitimate comment. Wrap PERFORM in a BEGIN/EXCEPTION
-- block so the comment INSERT always succeeds even if notification
-- enqueue fails. Exceptions are RAISEd as WARNINGs so they show up in
-- Supabase logs (Sentry doesn't see DB-side errors).

CREATE OR REPLACE FUNCTION public.handle_user_post_comment_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post RECORD;
  v_snippet TEXT;
BEGIN
  SELECT id, author_id, deleted_at, content
    INTO v_post
    FROM public.user_posts
   WHERE id = NEW.post_id;

  IF v_post.id IS NULL OR v_post.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF v_post.author_id = NEW.author_id THEN
    RETURN NEW;
  END IF;

  v_snippet := left(coalesce(NEW.content, ''), 140);

  -- Notification is a side-effect; never let its failure roll back the
  -- comment INSERT. Log via RAISE WARNING so DB ops can spot persistent
  -- failures.
  BEGIN
    PERFORM public.enqueue_notification(
      v_post.author_id,
      NEW.author_id,
      'user_post_comment_received'::public.profile_notification_kind,
      NEW.id,
      jsonb_build_object(
        'post_id', NEW.post_id,
        'comment_id', NEW.id,
        'snippet', v_snippet
      ),
      '/home'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_notification for user_post_comment_received failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_user_post_comment_notification IS
  'Notifies the post owner when someone else comments on their user_post. Notification is wrapped in EXCEPTION so a failed enqueue does not roll back the comment INSERT. Self-comments and comments on deleted posts are skipped. Block-aware via enqueue_notification.';
