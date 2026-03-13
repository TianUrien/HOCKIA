-- =============================================================================
-- Outreach: Instagram column + manual add contact RPC
--
-- 1. Add instagram column to outreach_contacts
-- 2. Update admin_get_outreach_contacts to return instagram
-- 3. Update admin_bulk_import_outreach_contacts to accept instagram
-- 4. New RPC: admin_add_outreach_contact (single manual add)
-- =============================================================================


-- 1. Add instagram column
ALTER TABLE public.outreach_contacts
  ADD COLUMN IF NOT EXISTS instagram TEXT;

COMMENT ON COLUMN public.outreach_contacts.instagram IS 'Instagram handle (without @)';


-- 2. Update admin_get_outreach_contacts to include instagram
CREATE OR REPLACE FUNCTION public.admin_get_outreach_contacts(
  p_status TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', oc.id,
      'email', oc.email,
      'contact_name', oc.contact_name,
      'club_name', oc.club_name,
      'country', oc.country,
      'role_at_club', oc.role_at_club,
      'phone', oc.phone,
      'instagram', oc.instagram,
      'notes', oc.notes,
      'status', oc.status,
      'source', oc.source,
      'world_club_id', oc.world_club_id,
      'converted_profile_id', oc.converted_profile_id,
      'converted_at', oc.converted_at,
      'first_contacted_at', oc.first_contacted_at,
      'last_contacted_at', oc.last_contacted_at,
      'created_at', oc.created_at,
      'total_count', COUNT(*) OVER()
    ) AS row_data,
    oc.created_at
    FROM public.outreach_contacts oc
    WHERE (p_status IS NULL OR oc.status = p_status)
      AND (p_country IS NULL OR oc.country ILIKE '%' || p_country || '%')
      AND (p_search IS NULL OR (
        oc.email ILIKE '%' || p_search || '%'
        OR oc.contact_name ILIKE '%' || p_search || '%'
        OR oc.club_name ILIKE '%' || p_search || '%'
      ))
    LIMIT p_limit
    OFFSET p_offset
  ) sub;

  RETURN v_result;
END;
$$;


-- 3. Update bulk import to accept instagram
CREATE OR REPLACE FUNCTION public.admin_bulk_import_outreach_contacts(
  p_contacts JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT;
  v_imported INT := 0;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  v_total := jsonb_array_length(p_contacts);

  WITH inserted AS (
    INSERT INTO public.outreach_contacts (
      email, contact_name, club_name, country,
      role_at_club, phone, instagram, notes, source, imported_by
    )
    SELECT
      lower(trim(c->>'email')),
      nullif(trim(c->>'contact_name'), ''),
      trim(c->>'club_name'),
      nullif(trim(c->>'country'), ''),
      nullif(trim(c->>'role_at_club'), ''),
      nullif(trim(c->>'phone'), ''),
      nullif(trim(c->>'instagram'), ''),
      nullif(trim(c->>'notes'), ''),
      'csv_import',
      auth.uid()
    FROM jsonb_array_elements(p_contacts) AS c
    WHERE trim(c->>'email') <> ''
      AND trim(c->>'club_name') <> ''
    ON CONFLICT (email) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_imported FROM inserted;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'skipped', v_total - v_imported,
    'total', v_total
  );
END;
$$;


-- 4. New RPC: admin_add_outreach_contact (single manual add)
CREATE OR REPLACE FUNCTION public.admin_add_outreach_contact(
  p_email TEXT,
  p_club_name TEXT,
  p_contact_name TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_role_at_club TEXT DEFAULT NULL,
  p_instagram TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact RECORD;
  v_email TEXT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  v_email := lower(trim(p_email));

  IF v_email = '' OR v_email IS NULL THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  IF position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;

  IF trim(p_club_name) = '' OR p_club_name IS NULL THEN
    RAISE EXCEPTION 'Club name is required';
  END IF;

  -- Check for duplicate
  IF EXISTS (SELECT 1 FROM public.outreach_contacts WHERE email = v_email) THEN
    RAISE EXCEPTION 'A contact with this email already exists';
  END IF;

  INSERT INTO public.outreach_contacts (
    email, contact_name, club_name, country,
    role_at_club, instagram, notes, source, imported_by
  ) VALUES (
    v_email,
    nullif(trim(p_contact_name), ''),
    trim(p_club_name),
    nullif(trim(p_country), ''),
    nullif(trim(p_role_at_club), ''),
    nullif(trim(p_instagram), ''),
    nullif(trim(p_notes), ''),
    'manual',
    auth.uid()
  )
  RETURNING * INTO v_contact;

  RETURN jsonb_build_object(
    'id', v_contact.id,
    'email', v_contact.email,
    'contact_name', v_contact.contact_name,
    'club_name', v_contact.club_name,
    'country', v_contact.country,
    'status', v_contact.status,
    'source', v_contact.source,
    'created_at', v_contact.created_at
  );
END;
$$;
