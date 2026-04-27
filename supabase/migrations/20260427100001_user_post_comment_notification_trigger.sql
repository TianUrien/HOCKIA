-- ============================================================================
-- Notify post owner when someone comments on their user_post
-- ============================================================================
-- Until now, when someone commented on your user_post (Home feed post)
-- nothing fired — the only path to discover engagement was opening the
-- post and noticing the comment count had ticked up. That broke the
-- engagement loop the rest of Phase 0 was meant to drive.
--
-- Behavior:
--   - Skips self-comments (don't notify yourself)
--   - Skips comments on soft-deleted posts
--   - Block-aware via enqueue_notification's existing block check
--
-- The 'user_post_comment_received' enum value is added in the prior
-- migration (20260427100000). ALTER TYPE ADD VALUE can't run in the
-- same transaction as a function that references the new label, so
-- the two are intentionally split.

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

  -- Post no longer exists / was deleted between read and trigger fire — skip
  IF v_post.id IS NULL OR v_post.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Don't notify the post owner about their own comment
  IF v_post.author_id = NEW.author_id THEN
    RETURN NEW;
  END IF;

  -- 140-char snippet of the comment for the notification description.
  v_snippet := left(coalesce(NEW.content, ''), 140);

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

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_user_post_comment_notification IS
  'Notifies the post owner when someone else comments on their user_post. Self-comments and comments on deleted posts are skipped. Block-aware via enqueue_notification.';

DROP TRIGGER IF EXISTS trg_user_post_comment_notification ON public.post_comments;

CREATE TRIGGER trg_user_post_comment_notification
  AFTER INSERT ON public.post_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_user_post_comment_notification();
