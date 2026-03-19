-- ============================================================================
-- Rebrand: PLAYR → HOCKIA
-- ============================================================================
-- Updates all stored email templates and template versions to reflect
-- the new brand name (HOCKIA) and domain (inhockia.com).
-- Also updates the profile role lock error message.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Update email_templates — subject lines and text templates
-- ============================================================================

UPDATE public.email_templates
SET
  subject_template = REPLACE(REPLACE(subject_template, 'PLAYR', 'HOCKIA'), 'oplayr.com', 'inhockia.com'),
  text_template    = REPLACE(REPLACE(text_template, 'PLAYR', 'HOCKIA'), 'oplayr.com', 'inhockia.com'),
  updated_at       = now()
WHERE
  subject_template ILIKE '%playr%'
  OR text_template ILIKE '%playr%'
  OR subject_template ILIKE '%oplayr%'
  OR text_template ILIKE '%oplayr%';

-- ============================================================================
-- 2. Update email_templates — content_json (JSONB text replacement)
-- ============================================================================

UPDATE public.email_templates
SET
  content_json = REPLACE(REPLACE(content_json::text, 'PLAYR', 'HOCKIA'), 'oplayr.com', 'inhockia.com')::jsonb,
  updated_at   = now()
WHERE
  content_json::text ILIKE '%playr%'
  OR content_json::text ILIKE '%oplayr%';

-- ============================================================================
-- 3. Update email_template_versions — same treatment
-- ============================================================================

UPDATE public.email_template_versions
SET
  subject_template = REPLACE(REPLACE(subject_template, 'PLAYR', 'HOCKIA'), 'oplayr.com', 'inhockia.com'),
  text_template    = REPLACE(REPLACE(text_template, 'PLAYR', 'HOCKIA'), 'oplayr.com', 'inhockia.com'),
  content_json     = REPLACE(REPLACE(content_json::text, 'PLAYR', 'HOCKIA'), 'oplayr.com', 'inhockia.com')::jsonb
WHERE
  subject_template ILIKE '%playr%'
  OR text_template ILIKE '%playr%'
  OR content_json::text ILIKE '%playr%'
  OR subject_template ILIKE '%oplayr%'
  OR text_template ILIKE '%oplayr%'
  OR content_json::text ILIKE '%oplayr%';

-- ============================================================================
-- 4. Update email_campaigns — any draft/active campaigns with PLAYR text
-- ============================================================================

UPDATE public.email_campaigns
SET
  subject = REPLACE(REPLACE(subject, 'PLAYR', 'HOCKIA'), 'oplayr.com', 'inhockia.com'),
  updated_at = now()
WHERE
  subject ILIKE '%playr%'
  OR subject ILIKE '%oplayr%';

-- ============================================================================
-- 5. Update outreach contact templates (if stored in outreach_contacts table)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'outreach_contacts'
  ) THEN
    EXECUTE $sql$
      UPDATE public.outreach_contacts
      SET notes = REPLACE(REPLACE(notes, 'PLAYR', 'HOCKIA'), 'oplayr.com', 'inhockia.com')
      WHERE notes ILIKE '%playr%' OR notes ILIKE '%oplayr%'
    $sql$;
  END IF;
END $$;

-- ============================================================================
-- 6. Update profile role lock error message
-- ============================================================================

-- The lock_profile_roles trigger uses a hardcoded message.
-- We replace it with the new brand name.
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    RAISE EXCEPTION 'Profile role is managed by HOCKIA staff';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
