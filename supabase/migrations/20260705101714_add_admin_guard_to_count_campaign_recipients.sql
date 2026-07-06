-- Adopted from prod's migration ledger (applied directly on prod 2026-07-05
-- as "add_admin_guard_to_count_campaign_recipients", outside git — recovered
-- verbatim from supabase_migrations.schema_migrations during the 2026-07-06
-- release-wave ledger reconciliation so local == remote everywhere; staging
-- picks it up on its next push). Adds the admin-only guard a security audit
-- required on the campaign recipient-count RPC.

CREATE OR REPLACE FUNCTION public.admin_count_campaign_recipients(p_audience_source text DEFAULT 'users'::text, p_audience_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source TEXT := COALESCE(NULLIF(p_audience_source, ''), 'users');
  v_roles TEXT[];
  v_country TEXT;
  v_status TEXT;
  v_club TEXT;
  v_contact_ids UUID[];
  v_has_contact_ids BOOLEAN := false;
  v_count BIGINT := 0;
BEGIN
  -- Admin-only check (added by security audit 2026-07-05)
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_source = 'outreach' THEN
    v_country := NULLIF(p_audience_filter->>'country', '');
    v_status := NULLIF(p_audience_filter->>'status', '');
    v_club := NULLIF(p_audience_filter->>'club', '');
    v_has_contact_ids := p_audience_filter ? 'contact_ids'
      AND jsonb_typeof(p_audience_filter->'contact_ids') = 'array';

    IF v_has_contact_ids THEN
      SELECT array_agg(elem::text::uuid)
      INTO v_contact_ids
      FROM jsonb_array_elements_text(p_audience_filter->'contact_ids') AS elem;

      IF COALESCE(array_length(v_contact_ids, 1), 0) = 0 THEN
        RETURN 0;
      END IF;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM public.outreach_contacts oc
    WHERE oc.status NOT IN ('bounced', 'unsubscribed', 'signed_up')
      AND (NOT v_has_contact_ids OR oc.id = ANY(v_contact_ids))
      AND (v_country IS NULL OR oc.country ILIKE '%' || v_country || '%')
      AND (v_status IS NULL OR oc.status = v_status)
      AND (v_club IS NULL OR oc.club_name ILIKE '%' || v_club || '%');

    RETURN COALESCE(v_count, 0)::INT;
  END IF;

  v_country := NULLIF(p_audience_filter->>'country', '');

  IF p_audience_filter ? 'roles' AND jsonb_typeof(p_audience_filter->'roles') = 'array' THEN
    SELECT array_agg(role_name)
    INTO v_roles
    FROM jsonb_array_elements_text(p_audience_filter->'roles') AS role_name;

    IF COALESCE(array_length(v_roles, 1), 0) = 0 THEN
      v_roles := NULL;
    END IF;
  ELSIF NULLIF(p_audience_filter->>'role', '') IS NOT NULL THEN
    v_roles := ARRAY[p_audience_filter->>'role'];
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.profiles p
  LEFT JOIN public.countries c ON c.id = p.nationality_country_id
  WHERE p.email IS NOT NULL
    AND p.email <> ''
    AND p.is_blocked = false
    AND COALESCE(p.is_test_account, false) = false
    AND (v_roles IS NULL OR p.role = ANY(v_roles))
    AND (v_country IS NULL OR c.code = v_country);

  RETURN COALESCE(v_count, 0)::INT;
END;
$function$;
