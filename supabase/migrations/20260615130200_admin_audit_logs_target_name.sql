-- ─────────────────────────────────────────────────────────────────────
-- Add target_name / target_email to admin_get_audit_logs so audit rows show
-- WHO was changed, not just the target type ("profile"). Adds a
-- LEFT JOIN profiles AS tp ON tp.id = l.target_id; null for non-profile
-- targets (vacancy / application / conversation / etc.) or deleted profiles
-- — the UI falls back to target_type in those cases.
--
-- RETURNS TABLE gains two columns, so the function must be DROPped and
-- recreated (CREATE OR REPLACE cannot change the return type). Re-applies
-- the hardened grants (revoke from PUBLIC/anon, grant to authenticated) that
-- 202512101002 + 202512101500 established, since DROP removes them.
-- ─────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_get_audit_logs(TEXT, TEXT, UUID, INTEGER, INTEGER);

CREATE FUNCTION public.admin_get_audit_logs(
  p_action TEXT DEFAULT NULL,
  p_target_type TEXT DEFAULT NULL,
  p_admin_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  admin_id UUID,
  admin_email TEXT,
  admin_name TEXT,
  action TEXT,
  target_type TEXT,
  target_id UUID,
  target_name TEXT,
  target_email TEXT,
  old_data JSONB,
  new_data JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_count BIGINT;
BEGIN
  -- Verify caller is admin
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  -- Get total count
  SELECT COUNT(*)
  INTO v_total_count
  FROM admin_audit_logs l
  WHERE
    (p_action IS NULL OR l.action = p_action)
    AND (p_target_type IS NULL OR l.target_type = p_target_type)
    AND (p_admin_id IS NULL OR l.admin_id = p_admin_id);

  RETURN QUERY
  SELECT
    l.id,
    l.admin_id,
    p.email AS admin_email,
    p.full_name AS admin_name,
    l.action,
    l.target_type,
    l.target_id,
    tp.full_name AS target_name,    -- NEW: who the action targeted (null if not a profile)
    tp.email AS target_email,       -- NEW
    l.old_data,
    l.new_data,
    l.metadata,
    l.created_at,
    v_total_count AS total_count
  FROM admin_audit_logs l
  LEFT JOIN profiles p ON p.id = l.admin_id
  LEFT JOIN profiles tp ON tp.id = l.target_id   -- NEW: resolve the target profile
  WHERE
    (p_action IS NULL OR l.action = p_action)
    AND (p_target_type IS NULL OR l.target_type = p_target_type)
    AND (p_admin_id IS NULL OR l.admin_id = p_admin_id)
  ORDER BY l.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Re-apply hardened privileges (DROP cleared them).
REVOKE ALL ON FUNCTION public.admin_get_audit_logs(TEXT, TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_audit_logs(TEXT, TEXT, UUID, INTEGER, INTEGER) TO authenticated;
