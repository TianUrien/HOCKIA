-- =============================================================================
-- Outreach Contacts — Phase 1
--
-- Adds external contact management for outbound email campaigns.
-- Enables CSV import of club contacts, personalized campaign sending,
-- and automatic funnel tracking from imported → signed_up.
--
-- Contents:
--   1. outreach_contacts table + indexes + RLS
--   2. email_campaigns.audience_source column
--   3. Status priority function
--   4. Auto-status triggers (email_sends → outreach, profiles INSERT → outreach)
--   5. RPCs: bulk import, list, stats, preview audience
--   6. 3 outreach email templates + version snapshots
-- =============================================================================


-- =============================================================================
-- 1. outreach_contacts table
-- =============================================================================

CREATE TABLE public.outreach_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  contact_name TEXT,
  club_name TEXT NOT NULL,
  country TEXT,
  role_at_club TEXT,
  phone TEXT,
  notes TEXT,
  world_club_id UUID REFERENCES public.world_clubs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'imported'
    CHECK (status IN (
      'imported', 'contacted', 'delivered', 'opened',
      'clicked', 'signed_up', 'bounced', 'unsubscribed'
    )),
  converted_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'csv_import'
    CHECK (source IN ('csv_import', 'manual')),
  imported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  first_contacted_at TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outreach_contacts_email_unique UNIQUE (email)
);

COMMENT ON TABLE public.outreach_contacts IS 'External contacts for outbound email campaigns (clubs, coaches not yet on HOCKIA)';
COMMENT ON COLUMN public.outreach_contacts.status IS 'Funnel status: imported → contacted → delivered → opened → clicked → signed_up (or bounced/unsubscribed)';

-- Indexes
CREATE INDEX idx_outreach_contacts_email ON public.outreach_contacts(email);
CREATE INDEX idx_outreach_contacts_status ON public.outreach_contacts(status);
CREATE INDEX idx_outreach_contacts_country ON public.outreach_contacts(country);
CREATE INDEX idx_outreach_contacts_world_club ON public.outreach_contacts(world_club_id);
CREATE INDEX idx_outreach_contacts_converted ON public.outreach_contacts(converted_profile_id);
CREATE INDEX idx_outreach_contacts_created ON public.outreach_contacts(created_at DESC);

-- updated_at trigger
CREATE TRIGGER set_outreach_contacts_updated_at
  BEFORE UPDATE ON public.outreach_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.outreach_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage outreach_contacts"
  ON public.outreach_contacts FOR ALL
  USING (public.is_platform_admin());


-- =============================================================================
-- 2. email_campaigns.audience_source column
-- =============================================================================

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS audience_source TEXT NOT NULL DEFAULT 'users'
    CHECK (audience_source IN ('users', 'outreach'));


-- =============================================================================
-- 3. Outreach status priority function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.outreach_status_priority(p_status TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'imported'     THEN 0
    WHEN 'contacted'    THEN 1
    WHEN 'delivered'    THEN 2
    WHEN 'opened'       THEN 3
    WHEN 'clicked'      THEN 4
    WHEN 'signed_up'    THEN 5
    WHEN 'bounced'      THEN 10
    WHEN 'unsubscribed' THEN 11
    ELSE -1
  END;
$$;


-- =============================================================================
-- 4a. Trigger: email_sends INSERT → mark contact as 'contacted'
-- =============================================================================

CREATE OR REPLACE FUNCTION public.outreach_on_email_sent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'sent' THEN
    UPDATE public.outreach_contacts
    SET status = 'contacted',
        first_contacted_at = COALESCE(first_contacted_at, now()),
        last_contacted_at = now()
    WHERE email = NEW.recipient_email
      AND outreach_status_priority(status) < outreach_status_priority('contacted');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_outreach_email_sent
  AFTER INSERT ON public.email_sends
  FOR EACH ROW
  EXECUTE FUNCTION public.outreach_on_email_sent();


-- =============================================================================
-- 4b. Trigger: email_sends UPDATE → progress contact status
-- =============================================================================

CREATE OR REPLACE FUNCTION public.outreach_on_email_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_outreach_status TEXT;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- Map email_sends status to outreach status
  v_new_outreach_status := CASE NEW.status
    WHEN 'delivered'     THEN 'delivered'
    WHEN 'opened'        THEN 'opened'
    WHEN 'clicked'       THEN 'clicked'
    WHEN 'bounced'       THEN 'bounced'
    WHEN 'complained'    THEN 'unsubscribed'
    WHEN 'unsubscribed'  THEN 'unsubscribed'
    ELSE NULL
  END;

  IF v_new_outreach_status IS NOT NULL THEN
    UPDATE public.outreach_contacts
    SET status = v_new_outreach_status
    WHERE email = NEW.recipient_email
      AND (
        -- Normal progression: only move forward
        (outreach_status_priority(v_new_outreach_status) <= 5
         AND outreach_status_priority(status) < outreach_status_priority(v_new_outreach_status))
        OR
        -- Bounced/unsubscribed override anything except signed_up
        (outreach_status_priority(v_new_outreach_status) >= 10
         AND status <> 'signed_up')
      );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_outreach_email_status_change
  AFTER UPDATE OF status ON public.email_sends
  FOR EACH ROW
  EXECUTE FUNCTION public.outreach_on_email_status_change();


-- =============================================================================
-- 4c. Trigger: profiles INSERT → mark contact as 'signed_up'
-- =============================================================================

CREATE OR REPLACE FUNCTION public.outreach_on_profile_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.outreach_contacts
  SET status = 'signed_up',
      converted_profile_id = NEW.id,
      converted_at = now()
  WHERE email = NEW.email
    AND status <> 'signed_up';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_outreach_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.outreach_on_profile_created();


-- =============================================================================
-- 5a. RPC: admin_bulk_import_outreach_contacts
-- =============================================================================

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
      role_at_club, phone, notes, source, imported_by
    )
    SELECT
      lower(trim(c->>'email')),
      nullif(trim(c->>'contact_name'), ''),
      trim(c->>'club_name'),
      nullif(trim(c->>'country'), ''),
      nullif(trim(c->>'role_at_club'), ''),
      nullif(trim(c->>'phone'), ''),
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


-- =============================================================================
-- 5b. RPC: admin_get_outreach_contacts
-- =============================================================================

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


-- =============================================================================
-- 5c. RPC: admin_get_outreach_stats
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_outreach_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  RETURN jsonb_build_object(
    'total',        (SELECT COUNT(*) FROM public.outreach_contacts),
    'imported',     (SELECT COUNT(*) FROM public.outreach_contacts WHERE status = 'imported'),
    'contacted',    (SELECT COUNT(*) FROM public.outreach_contacts WHERE status = 'contacted'),
    'delivered',    (SELECT COUNT(*) FROM public.outreach_contacts WHERE status = 'delivered'),
    'opened',       (SELECT COUNT(*) FROM public.outreach_contacts WHERE status = 'opened'),
    'clicked',      (SELECT COUNT(*) FROM public.outreach_contacts WHERE status = 'clicked'),
    'signed_up',    (SELECT COUNT(*) FROM public.outreach_contacts WHERE status = 'signed_up'),
    'bounced',      (SELECT COUNT(*) FROM public.outreach_contacts WHERE status = 'bounced'),
    'unsubscribed', (SELECT COUNT(*) FROM public.outreach_contacts WHERE status = 'unsubscribed')
  );
END;
$$;


-- =============================================================================
-- 5d. RPC: admin_preview_outreach_audience
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_preview_outreach_audience(
  p_audience_filter JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_country TEXT;
  v_status TEXT;
  v_count BIGINT;
  v_sample JSONB;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  v_country := p_audience_filter->>'country';
  v_status := p_audience_filter->>'status';

  -- Count eligible contacts (exclude bounced, unsubscribed, signed_up)
  SELECT COUNT(*) INTO v_count
  FROM public.outreach_contacts
  WHERE status NOT IN ('bounced', 'unsubscribed', 'signed_up')
    AND (v_country IS NULL OR country ILIKE '%' || v_country || '%')
    AND (v_status IS NULL OR status = v_status);

  -- Sample 10
  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb) INTO v_sample
  FROM (
    SELECT jsonb_build_object(
      'contact_name', contact_name,
      'email', email,
      'club_name', club_name,
      'country', country,
      'status', status
    ) AS row_data
    FROM public.outreach_contacts
    WHERE status NOT IN ('bounced', 'unsubscribed', 'signed_up')
      AND (v_country IS NULL OR country ILIKE '%' || v_country || '%')
      AND (v_status IS NULL OR status = v_status)
    ORDER BY created_at DESC
    LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'count', v_count,
    'sample', v_sample
  );
END;
$$;


-- =============================================================================
-- 5e. Update admin_create_email_campaign to accept audience_source
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_email_campaign(
  p_name TEXT,
  p_template_id UUID,
  p_category TEXT DEFAULT 'notification',
  p_audience_filter JSONB DEFAULT '{}'::jsonb,
  p_audience_source TEXT DEFAULT 'users'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_template_key TEXT;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Admin access required';
  END IF;

  SELECT template_key INTO v_template_key
  FROM public.email_templates
  WHERE id = p_template_id;

  IF v_template_key IS NULL THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  INSERT INTO public.email_campaigns (
    template_id, template_key, name, category, status,
    audience_filter, target_role, target_country,
    audience_source, created_by
  ) VALUES (
    p_template_id, v_template_key, p_name, p_category, 'draft',
    p_audience_filter,
    p_audience_filter->>'role',
    p_audience_filter->>'country',
    p_audience_source,
    auth.uid()
  )
  RETURNING * INTO v_campaign;

  RETURN jsonb_build_object(
    'id', v_campaign.id,
    'template_id', v_campaign.template_id,
    'template_key', v_campaign.template_key,
    'name', v_campaign.name,
    'category', v_campaign.category,
    'status', v_campaign.status,
    'audience_filter', v_campaign.audience_filter,
    'audience_source', v_campaign.audience_source,
    'target_role', v_campaign.target_role,
    'target_country', v_campaign.target_country,
    'created_at', v_campaign.created_at
  );
END;
$$;


-- =============================================================================
-- 6. Outreach email templates
-- =============================================================================

-- 6a. Introduction — cold intro, invite to claim club profile
INSERT INTO public.email_templates (
  template_key, name, description, category,
  subject_template, content_json, text_template,
  variables, is_active, current_version
) VALUES (
  'outreach_introduction',
  'Outreach: Club Introduction',
  'Cold outreach to clubs — introduces HOCKIA and invites them to claim their club profile.',
  'marketing',
  '{{club_name}}, your club is already on HOCKIA',
  '[
    {"type": "heading", "text": "Your club is on HOCKIA", "level": 1},
    {"type": "paragraph", "text": "Hi{{contact_name_greeting}},"},
    {"type": "paragraph", "text": "We''re reaching out because {{club_name}} is already listed on HOCKIA — the field hockey platform where clubs find players and coaches."},
    {"type": "paragraph", "text": "Claim your club profile to start posting opportunities and connecting with talent in {{country}} and beyond."},
    {"type": "button", "text": "Claim Your Club Profile", "url": "{{cta_url}}"},
    {"type": "footnote", "text": "HOCKIA is free for clubs. No commitment required."}
  ]'::jsonb,
  E'Your club is on HOCKIA\n\nHi{{contact_name_greeting}},\n\nWe''re reaching out because {{club_name}} is already listed on HOCKIA — the field hockey platform where clubs find players and coaches.\n\nClaim your club profile to start posting opportunities and connecting with talent in {{country}} and beyond.\n\nClaim Your Club Profile:\n{{cta_url}}\n\nHOCKIA is free for clubs. No commitment required.\n\n---\nHOCKIA Hockey | inhockia.com',
  '[
    {"name": "contact_name", "description": "Contact person name (optional)", "required": false},
    {"name": "contact_name_greeting", "description": "Greeting fragment: empty or '' Name'' (with leading space)", "required": false},
    {"name": "club_name", "description": "Club name", "required": true},
    {"name": "country", "description": "Country name", "required": false},
    {"name": "cta_url", "description": "Link to signup / claim page", "required": true}
  ]'::jsonb,
  true,
  1
);

-- 6b. Value Proof — follow-up, how it works
INSERT INTO public.email_templates (
  template_key, name, description, category,
  subject_template, content_json, text_template,
  variables, is_active, current_version
) VALUES (
  'outreach_value_proof',
  'Outreach: Value Proof',
  'Follow-up outreach — explains how HOCKIA works and the value for clubs.',
  'marketing',
  'Find your next player or coach on HOCKIA',
  '[
    {"type": "heading", "text": "How clubs use HOCKIA", "level": 1},
    {"type": "paragraph", "text": "Hi{{contact_name_greeting}},"},
    {"type": "paragraph", "text": "Clubs on HOCKIA post opportunities and receive applications from verified players and coaches — complete with highlight videos, references, and playing history."},
    {"type": "card", "title": "What you can do", "fields": [
      {"label": "Post opportunities", "value": "Player & coach vacancies"},
      {"label": "Browse talent", "value": "Filter by position, nationality, experience"},
      {"label": "Get applications", "value": "With video, references & history"}
    ]},
    {"type": "button", "text": "Get Started — It''s Free", "url": "{{cta_url}}"},
    {"type": "footnote", "text": "Questions? Reply to this email — we read every message."}
  ]'::jsonb,
  E'How clubs use HOCKIA\n\nHi{{contact_name_greeting}},\n\nClubs on HOCKIA post opportunities and receive applications from verified players and coaches — complete with highlight videos, references, and playing history.\n\nWhat you can do:\n- Post opportunities (player & coach vacancies)\n- Browse talent (filter by position, nationality, experience)\n- Get applications (with video, references & history)\n\nGet Started — It''s Free:\n{{cta_url}}\n\nQuestions? Reply to this email — we read every message.\n\n---\nHOCKIA Hockey | inhockia.com',
  '[
    {"name": "contact_name", "description": "Contact person name (optional)", "required": false},
    {"name": "contact_name_greeting", "description": "Greeting fragment", "required": false},
    {"name": "club_name", "description": "Club name", "required": true},
    {"name": "country", "description": "Country name", "required": false},
    {"name": "cta_url", "description": "Link to signup page", "required": true}
  ]'::jsonb,
  true,
  1
);

-- 6c. Social Proof — final push, other clubs in their country
INSERT INTO public.email_templates (
  template_key, name, description, category,
  subject_template, content_json, text_template,
  variables, is_active, current_version
) VALUES (
  'outreach_social_proof',
  'Outreach: Social Proof',
  'Final outreach push — social proof, other clubs in their country are already on HOCKIA.',
  'marketing',
  '{{club_name}} — clubs in {{country}} are already on HOCKIA',
  '[
    {"type": "heading", "text": "Clubs in {{country}} are on HOCKIA", "level": 1},
    {"type": "paragraph", "text": "Hi{{contact_name_greeting}},"},
    {"type": "paragraph", "text": "Field hockey clubs across {{country}} are using HOCKIA to find players and coaches. Don''t miss out on connecting with the next generation of talent."},
    {"type": "paragraph", "text": "Claiming your profile takes less than 2 minutes — and it''s completely free."},
    {"type": "button", "text": "Claim {{club_name}}''s Profile", "url": "{{cta_url}}"},
    {"type": "footnote", "text": "This is our last email about this. We won''t contact you again unless you sign up."}
  ]'::jsonb,
  E'Clubs in {{country}} are on HOCKIA\n\nHi{{contact_name_greeting}},\n\nField hockey clubs across {{country}} are using HOCKIA to find players and coaches. Don''t miss out on connecting with the next generation of talent.\n\nClaiming your profile takes less than 2 minutes — and it''s completely free.\n\nClaim {{club_name}}''s Profile:\n{{cta_url}}\n\nThis is our last email about this. We won''t contact you again unless you sign up.\n\n---\nHOCKIA Hockey | inhockia.com',
  '[
    {"name": "contact_name", "description": "Contact person name (optional)", "required": false},
    {"name": "contact_name_greeting", "description": "Greeting fragment", "required": false},
    {"name": "club_name", "description": "Club name", "required": true},
    {"name": "country", "description": "Country name", "required": false},
    {"name": "cta_url", "description": "Link to signup page", "required": true}
  ]'::jsonb,
  true,
  1
);

-- Create version 1 snapshots for the 3 outreach templates
INSERT INTO public.email_template_versions (
  template_id, version_number, subject_template, content_json,
  text_template, variables, change_note
)
SELECT
  t.id, 1, t.subject_template, t.content_json,
  t.text_template, t.variables,
  'Initial version — outreach template'
FROM public.email_templates t
WHERE t.template_key IN ('outreach_introduction', 'outreach_value_proof', 'outreach_social_proof');
