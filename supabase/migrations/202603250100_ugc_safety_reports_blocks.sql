-- UGC Safety: User reports, blocks, and terms acceptance (Apple Guideline 1.2)
-- Enables users to report objectionable content, block abusive users,
-- and accept terms before accessing user-generated content.

-- ============================================================
-- 1. user_reports — users can flag users or content
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_type  text CHECK (content_type IN ('user', 'post', 'comment')),
  content_id    uuid,
  reason        text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  category      text NOT NULL DEFAULT 'other' CHECK (category IN (
    'harassment', 'spam', 'inappropriate_content', 'impersonation',
    'hate_speech', 'violence', 'misinformation', 'other'
  )),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  reviewed_by   uuid REFERENCES auth.users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_report CHECK (reporter_id != target_id)
);

CREATE INDEX idx_user_reports_target ON public.user_reports(target_id);
CREATE INDEX idx_user_reports_status ON public.user_reports(status) WHERE status = 'pending';
CREATE INDEX idx_user_reports_reporter ON public.user_reports(reporter_id);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create reports"
  ON public.user_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "Users can view own reports"
  ON public.user_reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

CREATE POLICY "Admins full access to reports"
  ON public.user_reports FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- RPC to report a user or content (rate-limited: max 10 per day)
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

  -- Log to admin audit trail for developer notification (best-effort)
  BEGIN
    INSERT INTO public.admin_audit_logs (admin_id, action, target_type, target_id, metadata)
    VALUES (
      auth.uid(),
      'content_report',
      COALESCE(p_content_type, 'user'),
      COALESCE(p_content_id, p_target_id),
      jsonb_build_object(
        'report_id', v_report_id,
        'reporter_id', auth.uid(),
        'target_user_id', p_target_id,
        'category', p_category,
        'reason', p_reason,
        'content_type', COALESCE(p_content_type, 'user')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.report_user TO authenticated;

-- ============================================================
-- 2. user_blocks — users can block other users
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_block CHECK (blocker_id != blocked_id),
  CONSTRAINT unique_block UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX idx_user_blocks_blocker ON public.user_blocks(blocker_id);
CREATE INDEX idx_user_blocks_blocked ON public.user_blocks(blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create blocks"
  ON public.user_blocks FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "Users can view own blocks"
  ON public.user_blocks FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

CREATE POLICY "Users can remove own blocks"
  ON public.user_blocks FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());

CREATE POLICY "Admins can view all blocks"
  ON public.user_blocks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

-- RPC to block a user (removes friendship + logs to admin audit)
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

  -- Remove any friendship between the two users
  DELETE FROM public.profile_friendships
  WHERE (user_one = auth.uid() AND user_two = p_blocked_id)
     OR (user_one = p_blocked_id AND user_two = auth.uid());

  -- Log to admin audit trail for developer notification (best-effort)
  BEGIN
    INSERT INTO public.admin_audit_logs (admin_id, action, target_type, target_id, metadata)
    VALUES (
      auth.uid(),
      'user_block',
      'profile',
      p_blocked_id,
      jsonb_build_object(
        'blocker_id', auth.uid(),
        'blocked_id', p_blocked_id,
        'action', 'block'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Don't fail the block if audit logging fails
    NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.unblock_user(p_blocked_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.user_blocks
  WHERE blocker_id = auth.uid() AND blocked_id = p_blocked_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_user_blocked(p_other_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE blocker_id = auth.uid() AND blocked_id = p_other_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.block_user TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_user TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_blocked TO authenticated;

-- ============================================================
-- 3. terms_acceptance — track EULA acceptance (Apple Guideline 1.2)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.terms_acceptance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version     text NOT NULL DEFAULT '1.0',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_terms_version UNIQUE (user_id, version)
);

ALTER TABLE public.terms_acceptance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own acceptance"
  ON public.terms_acceptance FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can accept terms"
  ON public.terms_acceptance FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.accept_terms(p_version text DEFAULT '1.0')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.terms_acceptance (user_id, version)
  VALUES (auth.uid(), p_version)
  ON CONFLICT (user_id, version) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_accepted_terms(p_version text DEFAULT '1.0')
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.terms_acceptance
    WHERE user_id = auth.uid() AND version = p_version
  );
$$;

GRANT EXECUTE ON FUNCTION public.accept_terms TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_accepted_terms TO authenticated;
