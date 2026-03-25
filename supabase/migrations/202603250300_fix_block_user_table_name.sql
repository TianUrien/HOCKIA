-- Fix: block_user referenced non-existent "friendships" table
-- The correct table name is "profile_friendships"

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
