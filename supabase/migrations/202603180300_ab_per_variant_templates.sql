-- ============================================================================
-- A/B Testing: Per-variant template support + template duplication
-- ============================================================================
-- Extends A/B testing so each variant can use a different template.
-- Also adds template duplication RPC for easy variant creation.
--
-- ab_variants schema becomes:
--   {
--     "A": { "subject": "...", "template_id": "uuid", "template_key": "..." },
--     "B": { "subject": "...", "template_id": "uuid", "template_key": "..." }
--   }
-- ============================================================================

-- ============================================================================
-- 1. Template duplication RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_duplicate_email_template(
  p_template_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source email_templates%ROWTYPE;
  v_new_id UUID;
  v_new_key TEXT;
  v_suffix INT := 1;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT * INTO v_source FROM public.email_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  -- Generate unique template_key
  LOOP
    v_new_key := v_source.template_key || '_v' || v_suffix;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.email_templates WHERE template_key = v_new_key);
    v_suffix := v_suffix + 1;
  END LOOP;

  INSERT INTO public.email_templates (
    template_key,
    name,
    description,
    category,
    subject_template,
    content_json,
    text_template,
    variables,
    is_active,
    current_version
  ) VALUES (
    v_new_key,
    v_source.name || ' (Copy)',
    v_source.description,
    v_source.category,
    v_source.subject_template,
    v_source.content_json,
    v_source.text_template,
    v_source.variables,
    true,
    1
  )
  RETURNING id INTO v_new_id;

  -- Create initial version record
  INSERT INTO public.email_template_versions (
    template_id,
    version_number,
    subject_template,
    content_json,
    text_template,
    variables,
    change_note,
    created_by
  ) VALUES (
    v_new_id,
    1,
    v_source.subject_template,
    v_source.content_json,
    v_source.text_template,
    v_source.variables,
    'Duplicated from ' || v_source.name,
    auth.uid()
  );

  RETURN jsonb_build_object(
    'success', true,
    'template_id', v_new_id,
    'template_key', v_new_key,
    'name', v_source.name || ' (Copy)',
    'source_template_id', p_template_id
  );
END;
$$;
