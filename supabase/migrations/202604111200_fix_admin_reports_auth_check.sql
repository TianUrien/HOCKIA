-- Fix: admin_get_reports and admin_resolve_report were using profiles.role = 'admin'
-- but admin status is stored in JWT app_metadata.is_admin, not in the profiles table.
-- Must use is_platform_admin() like all other admin RPCs.

-- Re-create with correct admin check
CREATE OR REPLACE FUNCTION public.admin_get_reports(
  p_status TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  reporter_id UUID,
  reporter_name TEXT,
  reporter_avatar TEXT,
  target_id UUID,
  target_name TEXT,
  target_avatar TEXT,
  target_role TEXT,
  content_type TEXT,
  content_id UUID,
  reason TEXT,
  category TEXT,
  status TEXT,
  reviewed_by UUID,
  reviewer_name TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.user_reports ur
  WHERE (p_status IS NULL OR ur.status = p_status)
    AND (p_category IS NULL OR ur.category = p_category);

  RETURN QUERY
  SELECT
    r.id,
    r.reporter_id,
    rp.full_name AS reporter_name,
    rp.avatar_url AS reporter_avatar,
    r.target_id,
    tp.full_name AS target_name,
    tp.avatar_url AS target_avatar,
    tp.role AS target_role,
    r.content_type,
    r.content_id,
    r.reason,
    r.category,
    r.status,
    r.reviewed_by,
    rv.full_name AS reviewer_name,
    r.reviewed_at,
    r.created_at,
    v_total AS total_count
  FROM public.user_reports r
  LEFT JOIN public.profiles rp ON rp.id = r.reporter_id
  LEFT JOIN public.profiles tp ON tp.id = r.target_id
  LEFT JOIN public.profiles rv ON rv.id = r.reviewed_by
  WHERE (p_status IS NULL OR r.status = p_status)
    AND (p_category IS NULL OR r.category = p_category)
  ORDER BY
    CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,
    r.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_reports TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_resolve_report(
  p_report_id UUID,
  p_new_status TEXT,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  IF p_new_status NOT IN ('reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid status: must be reviewed, resolved, or dismissed';
  END IF;

  UPDATE public.user_reports
  SET status = p_new_status,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  INSERT INTO public.admin_audit_logs (admin_id, action, target_type, target_id, metadata)
  VALUES (
    auth.uid(),
    'resolve_report',
    'report',
    p_report_id,
    jsonb_build_object(
      'new_status', p_new_status,
      'admin_note', p_admin_note
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_resolve_report TO authenticated;
