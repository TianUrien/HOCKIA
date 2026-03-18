-- ============================================================================
-- Template rename RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_email_template_name(
  p_template_id UUID,
  p_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  UPDATE public.email_templates
  SET name = p_name, updated_at = now()
  WHERE id = p_template_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;
END;
$$;
