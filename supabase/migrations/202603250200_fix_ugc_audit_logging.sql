-- Fix: Wrap admin_audit_logs inserts in exception handlers
-- The admin_audit_logs table has RLS that may prevent non-admin inserts.
-- Using EXCEPTION blocks ensures block/report operations still succeed.

CREATE OR REPLACE FUNCTION public.block_user(p_blocked_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_blocked_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot block yourself.';
  END IF;

  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (auth.uid(), p_blocked_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  DELETE FROM public.profile_friendships
  WHERE (user_one = auth.uid() AND user_two = p_blocked_id)
     OR (user_one = p_blocked_id AND user_two = auth.uid());

  BEGIN
    INSERT INTO public.admin_audit_logs (admin_id, action, target_type, target_id, metadata)
    VALUES (
      auth.uid(), 'user_block', 'profile', p_blocked_id,
      jsonb_build_object('blocker_id', auth.uid(), 'blocked_id', p_blocked_id, 'action', 'block')
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_user(
  p_target_id uuid,
  p_reason text,
  p_category text DEFAULT 'other',
  p_content_type text DEFAULT 'user',
  p_content_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.user_reports
  WHERE reporter_id = auth.uid()
    AND created_at > now() - interval '24 hours';

  IF v_count >= 10 THEN
    RAISE EXCEPTION 'Report rate limit exceeded. Please try again later.';
  END IF;

  IF p_target_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot report yourself.';
  END IF;

  INSERT INTO public.user_reports (reporter_id, target_id, reason, category, content_type, content_id)
  VALUES (auth.uid(), p_target_id, p_reason, p_category, p_content_type, p_content_id)
  RETURNING id INTO v_report_id;

  BEGIN
    INSERT INTO public.admin_audit_logs (admin_id, action, target_type, target_id, metadata)
    VALUES (
      auth.uid(), 'content_report', COALESCE(p_content_type, 'user'), COALESCE(p_content_id, p_target_id),
      jsonb_build_object('report_id', v_report_id, 'reporter_id', auth.uid(), 'target_user_id', p_target_id,
        'category', p_category, 'reason', p_reason, 'content_type', COALESCE(p_content_type, 'user'))
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_report_id;
END;
$$;
